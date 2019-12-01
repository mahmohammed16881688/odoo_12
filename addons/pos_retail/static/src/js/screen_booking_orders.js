"use strict";
odoo.define('pos_retail.screen_sale_orders', function (require) {

    var models = require('point_of_sale.models');
    var screens = require('point_of_sale.screens');
    var core = require('web.core');
    var gui = require('point_of_sale.gui');
    var rpc = require('pos.rpc');
    var qweb = core.qweb;
    var PopupWidget = require('point_of_sale.popups');

    var _super_order = models.Order.prototype;
    models.Order = models.Order.extend({
        init_from_JSON: function (json) {
            _super_order.init_from_JSON.apply(this, arguments);
            if (json.booking_id) {
                this.booking_id = json.booking_id;
            }
        },
        export_as_JSON: function () {
            var json = _super_order.export_as_JSON.apply(this, arguments);
            if (this.booking_id) {
                json.booking_id = this.booking_id
            }
            return json;
        }
    });

    var button_create_sale_order = screens.ActionButtonWidget.extend({
        template: 'button_create_sale_order',
        button_click: function () {
            var self = this;
            var order = this.pos.get_order();
            if (order.is_return) {
                return this.pos.gui.show_popup('dialog', {
                    title: 'Error',
                    body: 'Return order not allow create sale order',
                });
            }
            var length = order.orderlines.length;
            if (!order.get_client()) {
                this.pos.gui.show_popup('dialog', {
                    title: 'Warning',
                    body: "Required add client the first",
                    color: 'success'
                });
                return self.pos.gui.show_screen('clientlist');
            }
            if (length == 0) {
                return this.gui.show_popup('dialog', {
                    title: 'Warning',
                    body: "Your order lines is empty",
                });
            }
            return this.gui.show_popup('popup_create_sale_order', {
                title: 'Create Quotation/Sale Order',
            });
        }
    });

    var popup_create_sale_order = PopupWidget.extend({ // popup create sale order
        template: 'popup_create_sale_order',
        init: function (parent, options) {
            this._super(parent, options);
        },
        show: function (options) {
            var self = this;
            this._super(options);
            this.$(".pos_signature").jSignature();
            this.signed = false;
            this.$(".pos_signature").bind('change', function (e) {
                self.signed = true;
            });
            this.$(".cancel").click(function (e) {
                self.pos.gui.close_popup();
            });
        },
        renderElement: function () {
            var self = this;
            this._super();
            this.$('.confirm').click(function () {
                var validate;
                var fields = {};
                self.$('.sale_order_field').each(function (idx, el) {
                    fields[el.name] = el.value || false;
                });
                var pricelist_id = null;
                var order = self.pos.get_order();
                if (!order) {
                    return;
                }
                var client = order.get_client();
                if (!client) {
                    return
                }
                var order = self.pos.get_order();
                if (self.signed == false && self.pos.config.sale_order_required_signature == true) {
                    self.wrong_input('.pos_signature');
                    validate = false;
                } else {
                    self.passed_input('.pos_signature');
                }
                if (validate == false) {
                    return;
                }
                var pricelist = order['pricelist'];
                if (!pricelist && this.pos.default_pricelist) {
                    pricelist_id = this.pos.default_pricelist.id;
                }
                if (pricelist) {
                    pricelist_id = pricelist.id;
                }
                var so_val = order.export_as_JSON();
                var value = {
                    note: self.$('.note').val(),
                    origin: 'POS/' + so_val.name,
                    partner_id: order.get_client().id,
                    pricelist_id: pricelist_id,
                    order_line: [],
                    signature: null,
                    book_order: true,
                    payment_term_id: parseInt(self.$('.payment_term_id').val())
                };
                var sign_datas = self.$(".pos_signature").jSignature("getData", "image");
                if (sign_datas && sign_datas[1]) {
                    value['signature'] = sign_datas[1]
                }
                for (var i = 0; i < so_val.lines.length; i++) {
                    var line = so_val.lines[i][2];
                    var product = self.pos.db.get_product_by_id(line.product_id)
                    var line_value = {
                        product_id: line.product_id,
                        price_unit: line.price_unit,
                        product_uom_qty: line.qty,
                        discount: line.discount,
                        product_uom: product.uom_id[0],
                        pack_lot_ids: [],
                    };
                    if (line.uom_id) {
                        line_value['product_uom'] = line.uom_id
                    }
                    if (line.pack_lot_ids) {
                        for (var x = 0; x < line.pack_lot_ids.length; x++) {
                            var lot = line.pack_lot_ids[x][2];
                            line_value.pack_lot_ids.push(lot['lot_name'])
                        }
                    }
                    if (product.tracking != 'none' && line.pack_lot_ids.length == 0) {
                        return self.gui.show_popup('dialog', {
                            title: 'Warning',
                            body: 'Please add lot number for ' + product['display_name'],
                        });
                    }
                    if (line.variants) {
                        line_value['variant_ids'] = [[6, false, []]];
                        for (var j = 0; j < line.variants.length; j++) {
                            var variant = line.variants[j];
                            line_value['variant_ids'][0][2].push(variant.id)
                        }
                    }
                    if (line.tax_ids) {
                        line_value['tax_id'] = line.tax_ids;
                    }
                    if (line.note) {
                        line_value['pos_note'] = line.note;
                    }
                    value.order_line.push([0, 0, line_value])
                }
                var fiscal_position_id = null;
                if (order.fiscal_position) {
                    fiscal_position_id = order.fiscal_position['id']
                    value['fiscal_position_id'] = fiscal_position_id;
                }
                var sale_order_auto_confirm = self.pos.config.sale_order_auto_confirm;
                var sale_order_auto_invoice = self.pos.config.sale_order_auto_invoice;
                var sale_order_auto_delivery = self.pos.config.sale_order_auto_delivery;
                self.pos.gui.close_popup();
                var status = new $.Deferred();
                rpc.query({
                    model: 'sale.order',
                    method: 'pos_create_sale_order',
                    args: [value, sale_order_auto_confirm, sale_order_auto_invoice, sale_order_auto_delivery]
                }).then(function (result) {
                    var order = self.pos.get_order();
                    order.name = result['name'];
                    order.uid = result['name'];
                    order.temporary = true;
                    self.link = window.location.origin + "/web#id=" + result.id + "&view_type=form&model=sale.order";
                    self.gui.show_popup('dialog', {
                        title: 'Good job',
                        body: 'Order ' + result['name'] + ' just created',
                        color: 'success'
                    });
                    window.open(self.link, '_blank');
                    if (self.pos.config.sale_order_print_receipt) {
                        self.pos.set('order', order);
                        self.pos.gui.show_screen('receipt');
                    } else {
                        order.destroy({'reason': 'abandon'});
                    }
                    return status.resolve()
                }).fail(function (type, error) {
                    self.pos.query_backend_fail(type, error);
                    return status.reject()
                });
                return status;

            })
        }
    });
    gui.define_popup({
        name: 'popup_create_sale_order',
        widget: popup_create_sale_order
    });

    var popup_create_booking_order = PopupWidget.extend({ // create booking order
        template: 'popup_create_booking_order',
        init: function (parent, options) {
            this._super(parent, options);
        },
        show: function (options) {
            var self = this;
            this._super(options);
            this.$('.datetimepicker').datetimepicker({
                format: 'YYYY-MM-DD H:mm:00',
                icons: {
                    time: "fa fa-clock-o",
                    date: "fa fa-calendar",
                    up: "fa fa-chevron-up",
                    down: "fa fa-chevron-down",
                    previous: 'fa fa-chevron-left',
                    next: 'fa fa-chevron-right',
                    today: 'fa fa-screenshot',
                    clear: 'fa fa-trash',
                    close: 'fa fa-remove'
                }
            });
            this.$(".pos_signature").jSignature();
            this.signed = false;
            this.$(".pos_signature").bind('change', function (e) {
                self.signed = true;
            });
            this.$(".cancel").click(function (e) {
                self.pos.gui.close_popup();
            });
        },
        renderElement: function () {
            var self = this;
            this._super();
            this.$('.cancel').click(function () {
                self.gui.close_popup();
            });
            this.$('.confirm').click(function () {
                var validate;
                var fields = {};
                self.$('.booking_field').each(function (idx, el) {
                    fields[el.name] = el.value || false;
                });
                var $pricelist_id = $('#pricelist_id').val();
                var pricelist_id = parseInt($pricelist_id);
                if (typeof pricelist_id != 'number' || isNaN(pricelist_id)) {
                    self.wrong_input('#pricelist_id');
                    validate = false;
                } else {
                    self.passed_input('#pricelist_id');
                }
                var order = self.pos.get_order();
                if (self.signed == false && self.pos.config.booking_orders_required_cashier_signature == true) {
                    self.wrong_input('.pos_signature');
                    validate = false;
                } else {
                    self.passed_input('.pos_signature');
                }
                var payment_partial_amount = parseFloat(fields['payment_partial_amount']);
                var $payment_partial_journal_id = $('#payment_partial_journal_id').val();
                var payment_partial_journal_id = parseInt($payment_partial_journal_id);
                if (payment_partial_amount > 0 && (typeof payment_partial_journal_id != 'number' || isNaN(payment_partial_journal_id))) {
                    return self.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Please select payment journal'
                    });
                }
                if (payment_partial_amount < 0) {
                    self.wrong_input('#payment_partial_amount');
                    validate = false;
                } else {
                    self.passed_input('#payment_partial_amount');
                }
                if (isNaN(payment_partial_amount)) {
                    payment_partial_amount = 0
                    payment_partial_journal_id = null
                }
                var $payment_method_id = $('#payment_method_id').val();
                var payment_method_id = parseInt($payment_method_id);
                if (payment_partial_amount > 0 && !payment_method_id) {
                    self.wrong_input('#payment_partial_amount');
                    validate = false;
                } else {
                    self.passed_input('#payment_partial_amount');
                }
                var so_val = order.export_as_JSON();
                var value = {
                    delivery_address: fields['delivery_address'],
                    delivery_phone: fields['delivery_phone'],
                    delivery_date: fields['delivery_date'],
                    note: fields['note'],
                    creation_date: so_val['creation_date'],
                    payment_partial_amount: payment_partial_amount,
                    payment_partial_journal_id: payment_partial_journal_id,
                    origin: 'POS/' + so_val.name,
                    partner_id: so_val.partner_id,
                    pricelist_id: pricelist_id,
                    order_line: [],
                    signature: null,
                    book_order: true,
                };
                var sign_datas = self.$(".pos_signature").jSignature("getData", "image");
                if (sign_datas && sign_datas[1]) {
                    value['signature'] = sign_datas[1]
                }
                for (var i = 0; i < so_val.lines.length; i++) {
                    var line = so_val.lines[i][2];
                    var product = self.pos.db.get_product_by_id(line.product_id)
                    var line_val = [0, 0, {
                        product_id: line.product_id,
                        price_unit: line.price_unit,
                        product_uom_qty: line.qty,
                        discount: line.discount,
                        product_uom: product.uom_id[0],
                    }];
                    if (line.uom_id) {
                        line_val['product_uom'] = line.uom_id
                    }
                    if (line.variants) {
                        line_val[2]['variant_ids'] = [[6, false, []]];
                        for (var j = 0; j < line.variants.length; j++) {
                            var variant = line.variants[j];
                            line_val[2]['variant_ids'][0][2].push(variant.id)
                        }
                    }
                    if (line.tax_ids) {
                        line_val[2]['tax_id'] = line.tax_ids;
                    }
                    if (line.note) {
                        line_val[2]['pos_note'] = line.note;
                    }
                    value.order_line.push(line_val);
                }
                if (validate == false) {
                    return;
                }
                // create booking order first
                self.pos.gui.show_popup('dialog', {
                    title: 'Requested',
                    body: 'Order sending to your odoo backend, waiting few seconds',
                    color: 'info'
                });
                rpc.query({
                    model: 'sale.order',
                    method: 'booking_order',
                    args: [value]
                }).then(function (result) {
                    self.pos.get_order().destroy();
                    self.link = window.location.origin + "/web#id=" + result.id + "&view_type=form&model=sale.order";
                    return self.pos.gui.show_popup('confirm', {
                        title: 'Done',
                        body: 'Are you want review sale order just created ?',
                        confirm: function () {
                            return window.open(self.link, '_blank');
                        }
                    })
                }).fail(function (type, error) {
                    return self.pos.query_backend_fail(type, error);
                });
                // create register payment second
                if (payment_partial_amount > 0 && payment_partial_journal_id) {
                    var payment = {
                        partner_type: 'customer',
                        payment_type: 'inbound',
                        partner_id: so_val.partner_id,
                        amount: payment_partial_amount,
                        currency_id: self.pos.currency['id'],
                        payment_date: new Date(),
                        journal_id: payment_partial_journal_id,
                        payment_method_id: payment_method_id,
                    };
                    rpc.query({
                        model: 'account.payment',
                        method: 'create',
                        args:
                            [payment]
                    }).then(function (payment_id) {
                        return rpc.query({
                            model: 'account.payment',
                            method: 'post',
                            args: [payment_id],
                            context: {
                                payment_id: payment_id,
                            }
                        }).then(function (result) {
                            self.pos.gui.show_popup('dialog', {
                                title: 'Registered',
                                body: 'Order just register payment done',
                                color: 'success'
                            });
                        }).fail(function (type, error) {
                            return self.pos.query_backend_fail(type, error);
                        });
                    }).fail(function (type, error) {
                        return self.pos.query_backend_fail(type, error);
                    });
                }
            })
        }
    });
    gui.define_popup({
        name: 'popup_create_booking_order',
        widget: popup_create_booking_order
    });
    var button_booking_order = screens.ActionButtonWidget.extend({
        template: 'button_booking_order',
        button_click: function () {
            var self = this;
            var order = this.pos.get_order();
            if (order.is_return) {
                return this.pos.gui.show_popup('dialog', {
                    title: 'Error',
                    body: 'Return order not allow create booking order',
                });
            }
            var pricelist = order['pricelist'];
            if (!pricelist) {
                pricelist = this.pos.default_pricelist;
            }
            var length = order.orderlines.length;
            if (!order.get_client()) {
                this.gui.show_popup('dialog', {
                    title: 'Warning',
                    body: "Required add client the first",
                });
                return this.pos.gui.show_screen('clientlist');

            }
            if (length == 0) {
                return this.gui.show_popup('dialog', {
                    title: 'Warning',
                    body: "Your order lines is blank",
                });
            }
            return this.gui.show_popup('popup_create_booking_order', {
                title: 'Create book order',
                pricelist: pricelist,
                order: order,
                client: order.get_client(),
            });
        }
    });

    screens.define_action_button({
        'name': 'button_create_sale_order',
        'widget': button_create_sale_order,
        'condition': function () {
            return this.pos.config.sale_order;
        }
    });

    screens.define_action_button({
        'name': 'button_booking_order',
        'widget': button_booking_order,
        'condition': function () {
            return this.pos.config.booking_orders;
        }
    });

    var button_go_sale_orders_screen = screens.ActionButtonWidget.extend({
        template: 'button_go_sale_orders_screen',
        init: function (parent, options) {
            this._super(parent, options);
        },
        button_click: function () {
            this.pos.gui.show_screen('sale_orders');
        }
    });
    screens.define_action_button({
        'name': 'button_go_sale_orders_screen',
        'widget': button_go_sale_orders_screen,
        'condition': function () {
            return this.pos.config.delivery_orders == true;
        }
    });

    /*
        This screen management 2 function:
        1) sale orders screen
        2) booked orders
    */
    var sale_orders = screens.ScreenWidget.extend({
        template: 'sale_orders',

        init: function (parent, options) {
            var self = this;
            this.sale_selected = null;
            this.reverse = true;
            this._super(parent, options);
            this.pos.bind('refresh:sale_orders_screen', function () {
                self.render_sale_orders(self.pos.db.get_sale_orders(1000));
                if (self.sale_selected) {
                    var order = self.pos.db.sale_order_by_id[self.sale_selected['id']];
                    if (order) {
                        self.display_sale_order(order)
                    } else {
                        self.hide_sale_selected();
                    }
                }
            }, this);
        },
        renderElement: function () {
            var self = this;
            this._super();
            this.$('.back').click(function () {
                self.gui.show_screen('products');
            });
        },
        apply_sort_sale_orders: function () {
            var self = this;
            this.$('.sort_by_create_date').click(function () {
                var orders = self.pos.db.get_sale_orders().sort(self.pos.sort_by('create_date', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase()
                }));
                self.render_sale_orders(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_sale_order_id').click(function () {
                var orders = self.pos.db.get_sale_orders().sort(self.pos.sort_by('id', self.reverse, parseInt));
                self.render_sale_orders(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_sale_order_name').click(function () {
                var orders = self.pos.db.get_sale_orders().sort(self.pos.sort_by('name', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase()
                }));
                self.render_sale_orders(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_sale_order_origin').click(function () {
                var orders = self.pos.db.get_sale_orders().sort(self.pos.sort_by('origin', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase()
                }));
                self.render_sale_orders(orders);
                self.reverse = !self.reverse;

            });
            this.$('.sort_by_sale_order_partner_name').click(function () {
                var orders = self.pos.db.get_sale_orders().sort(self.pos.sort_by('partner_name', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase()
                }));
                self.render_sale_orders(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_sale_order_date_order').click(function () {
                var orders = self.pos.db.get_sale_orders().sort(self.pos.sort_by('date_order', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase()
                }));
                self.render_sale_orders(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_sale_order_payment_partial_amount').click(function () {
                var orders = self.pos.db.get_sale_orders().sort(self.pos.sort_by('payment_partial_amount', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase();
                }));
                self.render_sale_orders(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_sale_order_amount_tax').click(function () {
                var orders = self.pos.db.get_sale_orders().sort(self.pos.sort_by('amount_tax', self.reverse, parseInt));
                self.render_sale_orders(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_sale_order_amount_total').click(function () {
                var orders = self.pos.db.get_sale_orders().sort(self.pos.sort_by('amount_total', self.reverse, parseInt));
                self.render_sale_orders(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_sale_order_state').click(function () {
                var orders = self.pos.db.get_sale_orders().sort(self.pos.sort_by('state', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase();
                }));
                self.render_sale_orders(orders);
                self.reverse = !self.reverse;
            });
        },
        refresh_screen: function () {
            var self = this;
            this.pos.get_modifiers_backend('sale.order').then(function () {
                self.pos.get_modifiers_backend('sale.order.line');
                self.pos.trigger('refresh:sale_orders_screen');
            });
        },
        show: function (options) {
            var sale_selected = this.sale_selected;
            this._super(options);
            this.apply_sort_sale_orders();
            var self = this;
            this.auto_complete_search();
            this.render_sale_orders(this.pos.db.get_sale_orders(1000));
            this.$('.client-list-contents').delegate('.sale_row', 'click', function (event) {
                self.order_select(event, $(this), parseInt($(this).data('id')));
            });
            var search_timeout = null;

            if (this.pos.config.iface_vkeyboard && this.chrome.widget.keyboard) {
                this.chrome.widget.keyboard.connect(this.$('.searchbox input'));
            }
            this.$('.searchbox input').on('keypress', function (event) {
                clearTimeout(search_timeout);
                var searchbox = this;
                search_timeout = setTimeout(function () {
                    self.perform_search(searchbox.value, event.which === 13);
                }, 70);
                var contents = self.$('.sale_order_detail');
                contents.empty();
            });
            this.$('.booked_order_button').click(function () {
                var sale_orders = _.filter(self.pos.db.get_sale_orders(), function (order) {
                    return order['book_order'] == true && (order['state'] == 'draft' || order['state'] == 'sent');
                });
                var contents = self.$('.sale_order_detail');
                contents.empty();
                self.render_sale_orders(sale_orders);

            });
            this.$('.button_sync').click(function () {
                self.refresh_screen()
            });
            this.$('.sale_lock_button').click(function () {
                var sale_orders = _.filter(self.pos.db.get_sale_orders(), function (order) {
                    return order['state'] == 'sale' || order['state'] == 'done';
                });
                var contents = self.$('.sale_order_detail');
                contents.empty();
                self.render_sale_orders(sale_orders);
            });
            this.$('.searchbox .search-clear').click(function () {
                var contents = self.$('.sale_order_detail');
                contents.empty();
                self.clear_search();
            });
            if (sale_selected) {
                var sale = self.pos.db.sale_order_by_id[sale_selected['id']];
                self.display_sale_order(sale);
            }
        },
        clear_search: function () {
            var contents = this.$('.sale_order_detail');
            contents.empty();
            this.render_sale_orders(this.pos.db.get_sale_orders(1000));
            this.$('.searchbox input')[0].value = '';
            this.$('.searchbox input').focus();
        },
        perform_search: function (query, associate_result) {
            var orders;
            if (query) {
                orders = this.pos.db.search_sale_orders(query);
                if (associate_result && orders.length === 1) {
                    return this.display_sale_order(orders[0]);
                }
                return this.render_sale_orders(orders);
            } else {
                sale_orders = this.pos.db.get_sale_orders(1000);
                return this.render_sale_orders(sale_orders);
            }
        },
        auto_complete_search: function () {
            var self = this;
            var $search_box = this.$('.searchbox >input');
            if ($search_box) {
                $search_box.autocomplete({
                    source: this.pos.db.get_sale_orders_source(),
                    minLength: this.pos.config.min_length_search,
                    select: function (event, ui) {
                        if (ui && ui['item'] && ui['item']['value']) {
                            var order = self.pos.db.sale_order_by_id[ui['item']['value']];
                            self.display_sale_order(order);
                            setTimeout(function () {
                                self.$('.searchbox input')[0].value = '';
                                self.$('.searchbox input').focus();
                            }, 1000);
                        }
                    }
                });
            }
        },
        partner_icon_url: function (id) {
            return '/web/image?model=res.partner&id=' + id + '&field=image_small';
        },
        order_select: function (event, $order, id) {
            var order = this.pos.db.sale_order_by_id[id];
            this.$('.client-line').removeClass('highlight');
            $order.addClass('highlight');
            this.display_sale_order(order);
        },
        render_sale_orders: function (sales) {
            var contents = this.$el[0].querySelector('.sale_orders_table');
            contents.innerHTML = "";
            for (var i = 0, len = Math.min(sales.length, 1000); i < len; i++) {
                var sale = sales[i];
                var sale_row_html = qweb.render('sale_row', {widget: this, sale: sale});
                var sale_row = document.createElement('tbody');
                sale_row.innerHTML = sale_row_html;
                sale_row = sale_row.childNodes[1];
                if (sale === this.sale_selected) {
                    sale_row.classList.add('highlight');
                } else {
                    sale_row.classList.remove('highlight');
                }
                contents.appendChild(sale_row);
            }
        },
        display_sale_order: function (sale) {
            this.sale_selected = sale;
            var self = this;
            var contents = this.$('.sale_order_detail');
            contents.empty();
            if (!sale) {
                return;
            }
            var $row_selected = this.$("[data-id='" + sale['id'] + "']");
            $row_selected.addClass('highlight');
            sale['link'] = window.location.origin + "/web#id=" + sale.id + "&view_type=form&model=sale.order";
            contents.append($(qweb.render('sale_order_detail', {widget: this, sale: sale})));
            var sale_lines = sale.lines;
            if (sale_lines) {
                var line_contents = this.$('.lines_detail');
                line_contents.empty();
                line_contents.append($(qweb.render('sale_order_lines', {widget: this, lines: sale_lines})));
            }
            this.$('.print_quotation').click(function () {
                if (!self.sale_selected) {
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Please select order the first'
                    })
                }
                self.chrome.do_action('sale.action_report_saleorder', {
                    additional_context: {
                        active_ids: [self.sale_selected['id']]
                    }
                })
            });
            this.$('.action_report_pro_forma_invoice').click(function () {
                if (!self.sale_selected) {
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Please select order the first'
                    })
                }
                self.chrome.do_action('sale.action_report_saleorder', {
                    additional_context: {
                        active_ids: [self.sale_selected['id']]
                    }
                });
                self.refresh_screen();
            });
            this.$('.action_confirm').click(function () {
                self.pos.gui.close_popup();
                if (!self.sale_selected) {
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Please select order the first'
                    })
                }
                return rpc.query({
                    model: 'sale.order',
                    method: 'action_confirm',
                    args:
                        [[self.sale_selected['id']]],
                    context: {
                        pos: true
                    }
                }).then(function () {
                    self.refresh_screen();
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Done',
                        body: 'Order just confirmed',
                        color: 'success'
                    })
                }).fail(function (type, error) {
                    return self.pos.query_backend_fail(type, error);
                })
            });
            this.$('.action_done').click(function () {
                if (!self.sale_selected) {
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Please select order the first'
                    })
                }
                return rpc.query({
                    model: 'sale.order',
                    method: 'action_done',
                    args:
                        [[self.sale_selected['id']]],
                    context: {
                        pos: true
                    }
                }).then(function () {
                    self.link = window.location.origin + "/web#id=" + self.sale_selected.id + "&view_type=form&model=sale.order";
                    self.refresh_screen();
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Done',
                        body: 'Order process to done(locked)',
                        color: 'success'
                    })
                }).fail(function (type, error) {
                    return self.pos.query_backend_fail(type, error);
                })
            });
            this.$('.action_return').click(function () {
                if (!self.sale_selected) {
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Please select order the first'
                    })
                }
                if (self.sale_selected) {
                    self.pos.gui.show_popup('popup_stock_return_picking', {
                        sale: self.sale_selected,
                        title: 'Return sale order',
                        confirm: function () {
                            self.render_sale_orders(self.pos.db.get_sale_orders(1000));
                        }
                    })
                }

            });
            this.$('.action_validate_picking').click(function () {
                if (!self.sale_selected) {
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Please select order the first'
                    })
                }
                if (self.sale_selected) {
                    return rpc.query({
                        model: 'sale.order',
                        method: 'action_validate_picking',
                        args:
                            [[self.sale_selected['id']]],
                        context: {
                            pos: true
                        }
                    }).then(function (picking_name) {
                        self.refresh_screen();
                        if (picking_name) {
                            return self.pos.gui.show_popup('dialog', {
                                title: 'Done',
                                body: 'Order process to delivery done',
                                color: 'success'
                            })
                        } else {
                            self.link = window.location.origin + "/web#id=" + self.sale_selected.id + "&view_type=form&model=sale.order";
                            return self.pos.gui.show_popup('confirm', {
                                title: 'Warning',
                                body: 'Order have 2 picking, please do manual',
                                confirm: function () {
                                    window.open(self.link, '_blank');
                                },
                                cancel: function () {
                                    self.pos.gui.close_popup();
                                }
                            })
                        }
                        return self.pos.gui.close_popup();
                    }).fail(function (type, error) {
                        return self.pos.query_backend_fail(type, error);
                    })
                }
            });
            this.$('.action_covert_to_pos_order').click(function () {
                if (!self.sale_selected) {
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Please select order the first'
                    })
                }
                if (self.sale_selected) {
                    var sale_selected = self.sale_selected;
                    var lines = sale_selected.lines;
                    if (!lines) {
                        return self.pos.gui.show_popup('dialog', {
                            title: 'Warning',
                            body: 'Sale order is blank lines, could not cover to pos order',
                        })
                    }
                    var order = new models.Order({}, {pos: self.pos, temporary: false});
                    order['name'] = self.sale_selected['name'];
                    order['sale_id'] = sale_selected['id'];
                    order['delivery_address'] = sale_selected['delivery_address'];
                    order['delivery_date'] = sale_selected['delivery_date'];
                    order['delivery_phone'] = sale_selected['delivery_phone'];
                    order['booking_id'] = self.sale_selected['id'];
                    var partner_id = sale_selected['partner_id'];
                    var partner = self.pos.db.get_partner_by_id(partner_id[0]);
                    if (partner) {
                        order.set_client(partner);
                    } else {
                        return self.pos.gui.show_popup('dialog', {
                            title: 'Warning',
                            body: 'Partner ' + partner_id[1] + ' not available on pos, please update this partner active on POS',
                        })
                    }
                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i];
                        var product = self.pos.db.get_product_by_id(line.product_id[0]);
                        if (!product) {
                            continue
                        } else {
                            var new_line = new models.Orderline({}, {pos: self.pos, order: order, product: product});
                            new_line.set_quantity(line.product_uom_qty, 'keep price');
                            order.orderlines.add(new_line);
                            new_line.set_discount(line.discount || 0)
                            if (line.variant_ids) {
                                var variants = _.map(line.variant_ids, function (variant_id) {
                                    if (self.pos.variant_by_id[variant_id]) {
                                        return self.pos.variant_by_id[variant_id]
                                    }
                                });
                                new_line.set_variants(variants);
                            }
                            if (line.pos_note) {
                                new_line.set_line_note(line.pos_note);
                            }
                            if (line.product_uom) {
                                var uom_id = line.product_uom[0];
                                var uom = self.pos.uom_by_id[uom_id];
                                if (uom) {
                                    new_line.set_unit(line.product_uom[0]);
                                } else {
                                    self.pos.gui.show_popup('dialog', {
                                        title: 'Warning',
                                        body: 'Your pos have not unit ' + line.product_uom[1]
                                    })
                                }
                            }
                            new_line.set_unit_price(line.price_unit);
                        }
                    }
                    if (self.sale_selected['payment_partial_amount'] && self.sale_selected['payment_partial_journal_id']) {
                        var payment_partial_journal_id = self.sale_selected['payment_partial_journal_id'][0];
                        var payment_partial_register = _.find(self.pos.cashregisters, function (cashregister) {
                            return cashregister.journal['id'] == payment_partial_journal_id;
                        });
                        if (payment_partial_register) {
                            var partial_paymentline = new models.Paymentline({}, {
                                order: order,
                                cashregister: payment_partial_register,
                                pos: self.pos
                            });
                            partial_paymentline.set_amount(self.sale_selected['payment_partial_amount']);
                            order.paymentlines.add(partial_paymentline);
                            order['amount_debit'] = order.get_total_with_tax() - self.sale_selected['payment_partial_amount']
                        } else {
                            return self.pos.gui.show_popup('dialog', {
                                title: 'Warning',
                                body: 'Payment method ' + self.sale_selected['payment_partial_journal_id'][1] + ' removed out pos config. We could not add payment before bac to this order',
                            })
                        }
                    }
                    var orders = self.pos.get('orders');
                    orders.add(order);
                    self.pos.set('selectedOrder', order);
                    return self.pos.gui.show_screen('products');
                }
            });
            this.$('.print_receipt').click(function () {
                if (!self.sale_selected) {
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Please select order the first'
                    })
                }
                if (self.sale_selected) {
                    var sale_selected = self.sale_selected;
                    var lines = sale_selected.lines;
                    if (!lines) {
                        return self.pos.gui.show_popup('dialog', {
                            title: 'Warning',
                            body: 'Sale order is blank lines, could not cover to pos order',
                        })
                    }
                    var order = new models.Order({}, {pos: self.pos, temporary: true});
                    order['name'] = self.sale_selected['name'];
                    order['sale_id'] = sale_selected['id'];
                    order['delivery_address'] = sale_selected['delivery_address'];
                    order['delivery_date'] = sale_selected['delivery_date'];
                    order['delivery_phone'] = sale_selected['delivery_phone'];
                    var partner_id = sale_selected['partner_id'];
                    var partner = self.pos.db.get_partner_by_id(partner_id[0]); // because sale order required have partner, we can get partner_id[0] and nothing bug
                    if (partner) {
                        order.set_client(partner);
                    } else {
                        return self.pos.gui.show_popup('dialog', {
                            title: 'Warning',
                            body: 'Partner ' + partner_id[1] + ' not available on pos, please update this partner active on POS',
                        })
                    }
                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i];
                        var product = self.pos.db.get_product_by_id(line.product_id[0])
                        if (!product) {
                            continue
                        } else {
                            var new_line = new models.Orderline({}, {pos: self.pos, order: order, product: product});
                            new_line.set_quantity(line.product_uom_qty, 'keep price');
                            order.orderlines.add(new_line);
                            new_line.set_discount(line.discount || 0)
                            if (line.variant_ids) {
                                var variants = _.map(line.variant_ids, function (variant_id) {
                                    if (self.pos.variant_by_id[variant_id]) {
                                        return self.pos.variant_by_id[variant_id]
                                    }
                                });
                                new_line.set_variants(variants);
                            }
                            if (line.pos_note) {
                                new_line.set_line_note(line.pos_note);
                            }
                            if (line.product_uom) {
                                var uom_id = line.product_uom[0];
                                var uom = self.pos.uom_by_id[uom_id];
                                if (uom) {
                                    new_line.set_unit(line.product_uom[0]);
                                } else {
                                    self.pos.gui.show_popup('dialog', {
                                        title: 'Warning',
                                        body: 'Your pos have not unit ' + line.product_uom[1]
                                    })
                                }
                            }
                            new_line.set_unit_price(line.price_unit);
                        }
                    }
                    var orders = self.pos.get('orders');
                    orders.add(order);
                    self.pos.set('selectedOrder', order);
                    return self.pos.gui.show_screen('receipt');
                }
            })
        },
        hide_sale_selected: function () {
            var contents = this.$('.sale_order_detail');
            contents.empty();
            this.sale_selected = null;

        }
    });
    gui.define_screen({name: 'sale_orders', widget: sale_orders});

    screens.OrderWidget.include({
        init: function (parent, options) {
            this._super(parent, options);
            var self = this;
            this.pos.bind('refresh:pos_orders_screen', function () {
                self.update_count_booked_orders();
            }, this);

        },
        update_count_booked_orders: function () { // set count booked orders
            var $booked_orders = $('.booked_orders');
            if ($booked_orders) {
                var sale_orders = _.filter(this.pos.db.get_sale_orders(), function (order) {
                    return order['book_order'] == true && (order['state'] == 'draft' || order['state'] == 'sent');
                });
                $booked_orders.text(sale_orders.length);
            }
        },
        active_button_create_sale_order: function (buttons, selected_order) {
            if (selected_order && buttons.button_create_sale_order && selected_order.is_return) {
                return buttons.button_create_sale_order.highlight(false);
            }
            if (buttons && buttons.button_create_sale_order) {
                if (selected_order && selected_order.get_client() && selected_order.orderlines.length > 0) {
                    return buttons.button_create_sale_order.highlight(true);
                } else {
                    return buttons.button_create_sale_order.highlight(false);
                }
            }
        },
        active_button_booking_order: function (buttons, selected_order) {
            if (selected_order && buttons.button_booking_order && selected_order.is_return) {
                return buttons.button_booking_order.highlight(false);
            }
            if (buttons.button_booking_order && selected_order.get_client()) {
                return buttons.button_booking_order.highlight(true);
            }
            if (buttons.button_booking_order && !selected_order.get_client()) {
                return buttons.button_booking_order.highlight(false);
            }
        },
        active_button_delivery_order: function (buttons, selected_order) {
            if (selected_order && buttons.button_delivery_order && selected_order.is_return) {
                return buttons.button_delivery_order.highlight(false);
            }
            if (buttons.button_delivery_order && selected_order.delivery_address) {
                buttons.button_delivery_order.highlight(true);
            }
            if (buttons.button_delivery_order && !selected_order.delivery_address) {
                buttons.button_delivery_order.highlight(false);
            }
        },
        show_delivery_address: function (buttons, selected_order) {
            if (selected_order && selected_order.is_return) {
                return;
            }
            var $delivery_address = this.el.querySelector('.delivery_address');
            var $delivery_date = this.el.querySelector('.delivery_date');
            if ($delivery_address) {
                $delivery_address.textContent = selected_order['delivery_address'];
            }
            if ($delivery_date) {
                $delivery_date.textContent = selected_order['delivery_date'];
            }
        },
        update_summary: function () {
            this._super();
            this.update_count_booked_orders();
            var buttons = this.getParent().action_buttons;
            var order = this.pos.get_order();
            if (order && buttons) {
                this.active_button_create_sale_order(buttons, order);
                this.active_button_booking_order(buttons, order);
                this.active_button_delivery_order(buttons, order);
                this.show_delivery_address(buttons, order);
            }
        }
    })
});
