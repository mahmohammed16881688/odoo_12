"use strict";
odoo.define('pos_retail.screen_voucher', function (require) {

    var core = require('web.core');
    var _t = core._t;
    var gui = require('point_of_sale.gui');
    var qweb = core.qweb;
    var PopupWidget = require('point_of_sale.popups');
    var rpc = require('pos.rpc');
    var models = require('point_of_sale.models');
    var screens = require('point_of_sale.screens');

    screens.ScreenWidget.include({
        show: function () {
            this._super();
            this.pos.barcode_reader.set_action_callback('voucher', _.bind(this.barcode_voucher_action, this));
        },
        barcode_voucher_action: function (datas) {
            var self = this;
            var status = new $.Deferred();
            console.log('barcode_voucher_action(): ' + datas['code']);
            rpc.query({
                model: 'pos.voucher',
                method: 'get_voucher_by_code',
                args: [datas['code']],
            }).then(function (voucher) {
                if (voucher == -1) {
                    self.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Voucher expired date or used before',
                    });
                    return status.resolve(false);
                } else {
                    var current_order = self.pos.get('selectedOrder');
                    current_order.voucher_id = voucher.id;
                    var voucher_register = _.find(self.pos.cashregisters, function (cashregister) {
                        return cashregister.journal['pos_method_type'] == 'voucher';
                    });
                    if (voucher_register) {
                        if (voucher['customer_id'] && voucher['customer_id'][0]) {
                            var client = self.pos.db.get_partner_by_id(voucher['customer_id'][0]);
                            if (client) {
                                current_order.set_client(client)
                            }
                        }
                        var amount = 0;
                        if (voucher['apply_type'] == 'fixed_amount') {
                            amount = voucher.value;
                        } else {
                            amount = current_order.get_total_with_tax() / 100 * voucher.value;
                        }
                        if (amount <= 0) {
                            return self.pos.gui.show_popup('dialog', {
                                title: 'Warning',
                                body: 'Voucher limited value',
                            });
                        }
                        // remove old paymentline have journal is voucher
                        var paymentlines = current_order.paymentlines;
                        for (var i = 0; i < paymentlines.models.length; i++) {
                            var payment_line = paymentlines.models[i];
                            if (payment_line.cashregister.journal['pos_method_type'] == 'voucher') {
                                payment_line.destroy();
                            }
                        }
                        // add new payment with this voucher just scanned
                        var voucher_paymentline = new models.Paymentline({}, {
                            order: current_order,
                            cashregister: voucher_register,
                            pos: self.pos
                        });
                        voucher_paymentline['voucher_id'] = voucher['id'];
                        voucher_paymentline['voucher_code'] = voucher['code'];
                        var due = current_order.get_due();
                        if (amount >= due) {
                            voucher_paymentline.set_amount(due);
                        } else {
                            voucher_paymentline.set_amount(amount);
                        }
                        voucher_paymentline['voucher_id'] = voucher['id'];
                        current_order.paymentlines.add(voucher_paymentline);
                        current_order.trigger('change', current_order);
                        self.pos.gui.show_popup('dialog', {
                            title: 'Good job !',
                            body: 'Voucher code ' + voucher['code'] + ' just added to payment screen',
                            color: 'success'
                        });
                        return status.resolve(true);

                    } else {
                        self.pos.gui.show_popup('dialog', {
                            title: 'Warning !',
                            body: 'Your pos config have not added payment method voucher or your payment method have type is not voucher',
                        });
                        return status.reject(false);
                    }
                }
            }).fail(function (type, error) {
                self.pos.gui.show_popup('dialog', {
                    title: 'Warning !',
                    body: 'Your odoo system have offline, or your internet have problem',
                });
                return status.reject(false);
            });
            return status;
        }
    });

    var _super_PosModel = models.PosModel.prototype;
    models.PosModel = models.PosModel.extend({
        initialize: function (session, attributes) {
            var wait_journal = this.get_model('account.journal');
            wait_journal.fields.push('pos_method_type');
            _super_PosModel.initialize.apply(this, arguments);
        },
        _flush_orders: function (orders, options) {
            var self = this;
            return _super_PosModel._flush_orders.apply(this, arguments).done(function (order_ids) {
                if (order_ids.length == 0) {
                    return true;
                }
                var status = new $.Deferred();
                rpc.query({
                    model: 'pos.voucher',
                    method: 'get_vouchers_by_order_ids',
                    args: [[], order_ids]
                }).then(function (vouchers_created) {
                    if (vouchers_created.length) {
                        self.vouchers_created = vouchers_created;
                        self.gui.show_screen('vouchers_screen');
                        self.gui.show_screen(self.gui.startup_screen);
                    }
                    status.resolve()
                }).fail(function () {
                    status.reject()
                });
                return status
            })
        }
    });

    var _super_Order = models.Order.prototype;
    models.Order = models.Order.extend({
        init_from_JSON: function (json) {
            var res = _super_Order.init_from_JSON.apply(this, arguments);
            if (json.voucher) {
                this.voucher = json.voucher
            }
            if (json.create_voucher) {
                this.create_voucher = json.create_voucher
            }
            return res;
        },
        export_as_JSON: function () {
            var json = _super_Order.export_as_JSON.apply(this, arguments);
            if (this.voucher_id) {
                json.voucher_id = parseInt(this.voucher_id);
            }
            if (this.voucher) {
                json.voucher = this.voucher;
            }
            if (this.create_voucher) {
                json.create_voucher = this.create_voucher;
            }
            return json;
        },
        show_popup_create_voucher: function () {
            var selected_line = this.selected_orderline;
            if (selected_line) {
                this.pos.gui.show_popup('popup_print_vouchers', {
                    'selected_line': selected_line,
                    'title': 'Please input information of voucher will create'
                });
            }
        },
        add_product: function (product, options) {
            var self = this;
            _super_Order.add_product.apply(this, arguments);
            if (product.is_voucher && this.pos.config.print_voucher) {
                setTimeout(function () {
                    self.show_popup_create_voucher();
                }, 1000);
            }
        },
        get_order_is_create_voucher: function () {
            return this.create_voucher;
        },
        set_order_create_voucher: function () {
            this.create_voucher = !this.create_voucher;
            if (this.create_voucher) {
                this.add_credit = false;
                this.set_to_invoice(false);
            }
            this.trigger('change');
        }
    });

    var _super_Orderline = models.Orderline.prototype;
    models.Orderline = models.Orderline.extend({
        initialize: function (attributes, options) {
            var res = _super_Orderline.initialize.apply(this, arguments);
            if (!this.voucher) {
                this.voucher = {};
            }
            return res;
        },
        init_from_JSON: function (json) {
            var res = _super_Orderline.init_from_JSON.apply(this, arguments);
            if (json.voucher) {
                this.voucher = json.voucher
            }
            return res
        },
        export_as_JSON: function () {
            var json = _super_Orderline.export_as_JSON.apply(this, arguments);
            if (this.voucher) {
                json.voucher = this.voucher;
            }
            return json;
        },
        export_for_printing: function () {
            var receipt_line = _super_Orderline.export_for_printing.apply(this, arguments);
            if (this.voucher) {
                receipt_line['voucher'] = this.voucher;
            }
            return receipt_line
        }
    });

    var _super_Paymentline = models.Paymentline.prototype;
    models.Paymentline = models.Paymentline.extend({
        init_from_JSON: function (json) {
            var res = _super_Paymentline.init_from_JSON.apply(this, arguments);
            if (json.voucher_id) {
                this.voucher_id = json.voucher_id
            }
            if (json.voucher_code) {
                this.voucher_code = json.voucher_code
            }
            return res
        },
        export_as_JSON: function () {
            var json = _super_Paymentline.export_as_JSON.apply(this, arguments);
            if (this.voucher_id) {
                json['voucher_id'] = this.voucher_id;
            }
            if (this.voucher_code) {
                json['voucher_code'] = this.voucher_code;
            }
            return json
        },
        export_for_printing: function () {
            var datas = _super_Paymentline.export_for_printing.apply(this, arguments);
            if (this.voucher_code) {
                datas['voucher_code'] = this.voucher_code
            }
            return datas
        }
    });

    screens.PaymentScreenWidget.include({
        renderElement: function () {
            var self = this;
            this._super();
            this.$('.js_create_voucher').click(function () { // create voucher
                var selected_order = self.pos.get_order();
                return selected_order.set_order_create_voucher();
            });
            this.$('.input_voucher').click(function () { // input manual voucher
                self.hide();
                return self.pos.gui.show_popup('alert_input', {
                    title: _t('Voucher'),
                    body: _t('Please input code or number of voucher.'),
                    confirm: function (code) {
                        self.show();
                        self.renderElement();
                        if (!code) {
                            return false;
                        } else {
                            return rpc.query({
                                model: 'pos.voucher',
                                method: 'get_voucher_by_code',
                                args: [code],
                            }).then(function (voucher) {
                                if (voucher == -1) {
                                    return self.gui.show_popup('dialog', {
                                        title: 'Warning',
                                        body: 'Voucher code used before or code doest not exist',
                                    });
                                } else {
                                    var current_order = self.pos.get('selectedOrder');
                                    current_order.voucher_id = voucher.id;
                                    var voucher_register = _.find(self.pos.cashregisters, function (cashregister) {
                                        return cashregister.journal['pos_method_type'] == 'voucher';
                                    });
                                    if (voucher_register) {
                                        if (voucher['customer_id'] && voucher['customer_id'][0]) {
                                            var client = self.pos.db.get_partner_by_id(voucher['customer_id'][0]);
                                            if (client) {
                                                current_order.set_client(client)
                                            }
                                        }
                                        var amount = 0;
                                        if (voucher['apply_type'] == 'fixed_amount') {
                                            amount = voucher.value;
                                        } else {
                                            amount = current_order.get_total_with_tax() / 100 * voucher.value;
                                        }
                                        if (amount <= 0) {
                                            return self.pos.gui.show_popup('dialog', {
                                                title: 'Warning',
                                                body: 'Voucher limited value',
                                            });
                                        }
                                        // remove old paymentline have journal is voucher
                                        var paymentlines = current_order.paymentlines;
                                        for (var i = 0; i < paymentlines.models.length; i++) {
                                            var payment_line = paymentlines.models[i];
                                            if (payment_line.cashregister.journal['pos_method_type'] == 'voucher') {
                                                payment_line.destroy();
                                            }
                                        }
                                        // add new payment with this voucher just scanned
                                        var voucher_paymentline = new models.Paymentline({}, {
                                            order: current_order,
                                            cashregister: voucher_register,
                                            pos: self.pos
                                        });
                                        var due = current_order.get_due();
                                        if (amount >= due) {
                                            voucher_paymentline.set_amount(due);
                                        } else {
                                            voucher_paymentline.set_amount(amount);
                                        }
                                        voucher_paymentline['voucher_id'] = voucher['id'];
                                        voucher_paymentline['voucher_code'] = voucher['code'];
                                        current_order.paymentlines.add(voucher_paymentline);
                                        current_order.trigger('change', current_order);
                                        self.render_paymentlines();
                                        self.$('.paymentline.selected .edit').text(self.format_currency_no_symbol(amount));
                                    } else {
                                        return self.pos.gui.show_popup('dialog', {
                                            title: 'Warning',
                                            body: 'POS config not add payment method Voucher. Please add method voucher, close and reopen session',
                                        });
                                    }

                                }
                            }).fail(function (type, error) {
                                return self.pos.query_backend_fail(type, error);
                            });
                        }
                    },
                    cancel: function () {
                        self.show();
                        self.renderElement();
                    }
                });
            });
        },
        render_paymentlines: function () {
            this._super();
            // Show || Hide Voucher method
            // find voucher journal inside this pos
            // and hide this voucher element, because if display may be made seller confuse
            var voucher_journal = _.find(this.pos.cashregisters, function (cashregister) {
                return cashregister.journal['pos_method_type'] == 'voucher';
            });
            if (voucher_journal) {
                var voucher_journal_id = voucher_journal.journal.id;
                var voucher_journal_content = $("[data-id='" + voucher_journal_id + "']");
                voucher_journal_content.addClass('oe_hidden');
            }
        },
    });

    var vouchers_screen = screens.ScreenWidget.extend({
        template: 'vouchers_screen',

        show: function () {
            this._super();
            this.vouchers = this.pos.vouchers_created;
            if (this.vouchers) {
                this.render_vouchers();
            }
            this.handle_auto_print();
        },
        handle_auto_print: function () {
            if (this.should_auto_print()) {
                this.print();
                if (this.should_close_immediately()) {
                    this.click_back();
                }
            } else {
                this.lock_screen(false);
            }
        },
        should_auto_print: function () {
            return this.pos.config.iface_print_auto;
        },
        should_close_immediately: function () {
            return this.pos.config.iface_print_via_proxy;
        },
        lock_screen: function (locked) {
            this.$('.back').addClass('highlight');
        },
        get_voucher_env: function (voucher) {
            var cashier = this.pos.get_cashier();
            var company = this.pos.company;
            var shop = this.pos.shop;
            return {
                widget: this,
                pos: this.pos,
                cashier: cashier,
                company: company,
                shop: shop,
                voucher: voucher
            };
        },
        print_web: function () {
            window.print();
        },
        print_xml: function () {
            if (this.vouchers) {
                for (var i = 0; i < this.vouchers.length; i++) {
                    var voucher_xml = qweb.render('voucher_ticket_xml', this.get_voucher_env(this.vouchers[i]));
                    this.pos.proxy.print_receipt(voucher_xml);
                }
            }
        },
        print: function () {
            var self = this;
            if (this.pos.config.iface_print_via_proxy) {
                this.print_xml();
                this.lock_screen(false);
            } else {
                this.print_web();
            }
        },
        click_back: function () {
            var default_screen = this.pos.gui.startup_screen;
            this.pos.gui.show_screen(default_screen);
        },
        renderElement: function () {
            var self = this;
            this._super();
            this.$('.back').click(function () {
                self.click_back();
            });
            this.$('.button.print').click(function () {
                self.print();
            });
        },
        render_change: function () {
            this.$('.change-value').html(this.format_currency(this.pos.get_order().get_change()));
        },
        render_vouchers: function () {
            var $voucher_content = this.$('.pos-receipt-container');
            var url_location = window.location.origin + '/report/barcode/EAN13/';
            $voucher_content.empty();
            if (this.vouchers) {
                for (var i = 0; i < this.vouchers.length; i++) {
                    this.vouchers[i]['url_barcode'] = url_location + this.vouchers[i]['code'];
                    $voucher_content.append(
                        qweb.render('voucher_ticket_html', this.get_voucher_env(this.vouchers[i]))
                    );
                }
            }
        }
    });
    gui.define_screen({name: 'vouchers_screen', widget: vouchers_screen});

    var popup_print_vouchers = PopupWidget.extend({
        template: 'popup_print_vouchers',
        show: function (options) {
            var self = this;
            this.selected_line = options.selected_line;
            this.options = options;
            this._super(options);
            this.$('.print-voucher').click(function () {
                var order = self.pos.get_order();
                if (!order) {
                    return false;
                }
                var selected_line = order.get_selected_orderline();
                if (!selected_line) {
                    return false;
                }
                var voucher_amount = selected_line.get_price_with_tax();
                var validate;
                var number = parseFloat(self.$('.number').val());
                var period_days = parseFloat(self.$('.period_days').val());
                var apply_type = self.$('.apply_type').val();
                var method = self.$('.method').val();
                var customer = self.pos.get_order().get_client();
                if (method == "special_customer" && !customer) {
                    self.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Because apply to special customer, required select customer the first'
                    });
                    return self.pos.gui.show_screen('clientlist')
                }
                if (isNaN(number)) {
                    self.wrong_input('.number');
                    validate = false;
                } else {
                    self.passed_input('.number');
                }
                if (typeof period_days != 'number' || isNaN(period_days) || period_days <= 0) {
                    self.wrong_input('.period_days');
                    validate = false;
                } else {
                    self.passed_input('.period_days');
                }
                if (typeof voucher_amount != 'number' || isNaN(voucher_amount) || voucher_amount <= 0) {
                    self.wrong_input('.voucher_amount');
                    validate = false;
                } else {
                    self.passed_input('.voucher_amount');
                }
                if (validate == false) {
                    return;
                }
                var voucher_data = {
                    apply_type: apply_type,
                    value: voucher_amount,
                    method: method,
                    period_days: period_days,
                    number: number
                };
                if (customer) {
                    voucher_data['customer_id'] = customer['id'];
                }
                self.selected_line.voucher = voucher_data;
                self.click_cancel();
            });
            this.$('.cancel').click(function () {
                var voucher_data = {
                    apply_type: 'fixed_amount',
                    method: 'general',
                    period_days: self.pos.config.expired_days_voucher,
                };
                self.selected_line.voucher = voucher_data;
                self.click_cancel();
            });
        }
    });
    gui.define_popup({
        name: 'popup_print_vouchers',
        widget: popup_print_vouchers
    });

    screens.OrderWidget.include({
        remove_orderline: function (order_line) {
            try {
                this._super(order_line);
            } catch (ex) {
                console.log('dont worries, client without table select');
            }
        },
        update_summary: function () { // auto high light button edit voucher or disable high light
            this._super();
            var buttons = this.getParent().action_buttons;
            var order = this.pos.get_order();
            if (order && buttons && buttons.button_create_voucher) {
                var selected_line = order.selected_orderline;
                if (selected_line && selected_line.product && selected_line.product.is_voucher) {
                    buttons.button_create_voucher.highlight(true);
                } else {
                    buttons.button_create_voucher.highlight(false);
                }
            }
        }
    });

    var button_create_voucher = screens.ActionButtonWidget.extend({ // combo button
        template: 'button_create_voucher',
        button_click: function () {
            var order = this.pos.get_order();
            if (!order) {
                return;
            }
            var selected_line = order.selected_orderline;
            if (selected_line && selected_line.product.is_voucher) {
                this.pos.gui.show_popup('popup_print_vouchers', {
                    'selected_line': selected_line,
                    'title': 'Please input information of voucher will create'
                });
            } else {
                this.pos.gui.show_popup('dialog', {
                    title: 'Warning',
                    body: 'Line selected is not voucher'
                });
            }
        }
    });

    screens.define_action_button({
        'name': 'button_create_voucher',
        'widget': button_create_voucher,
        'condition': function () {
            return this.pos.config.print_voucher;
        }
    });

    var button_print_vouchers = screens.ActionButtonWidget.extend({
        template: 'button_print_vouchers',
        button_click: function () {
            if (this.pos.vouchers_created) {
                return this.pos.gui.show_screen('vouchers_screen')
            } else {
                return this.pos.gui.show_popup('dialog', {
                    title: 'Warning',
                    body: 'Have not any vouchers create before'
                })
            }
        }
    });

    screens.define_action_button({
        'name': 'button_print_vouchers',
        'widget': button_print_vouchers,
        'condition': function () {
            return this.pos.config.print_voucher;
        }
    });
});
