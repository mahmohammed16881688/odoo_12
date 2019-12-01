"use strict";
odoo.define('pos_retail.screen_payment', function (require) {

    var models = require('point_of_sale.models');
    var screens = require('point_of_sale.screens');
    var core = require('web.core');
    var _t = core._t;
    var rpc = require('pos.rpc');
    var qweb = core.qweb;
    var utils = require('web.utils');
    var round_di = utils.round_decimals;
    var BarcodeEvents = require('barcodes.BarcodeEvents').BarcodeEvents;

    var _super_paymentlinne = models.Paymentline.prototype;
    models.Paymentline = models.Paymentline.extend({
        initialize: function (attributes, options) {
            _super_paymentlinne.initialize.apply(this, arguments);
            this.amount_currency = this.amount_currency || 0;
            this.currency_id = this.currency_id || null;
        },
        set_amount: function (value) { // add currency_id and amount_currency for account bank statement line backend
            _super_paymentlinne.set_amount.apply(this, arguments);
            var order = this.pos.get_order();
            var company_currency = this.pos.currency_by_id[this.pos.currency['id']];
            var amount = parseFloat(value);
            if (this.selected_currency) {
                this.currency_id = this.selected_currency['id'];
                this.amount_currency = amount;
                this.amount = this.amount_currency * company_currency['rate'] / this.selected_currency['rate'];
            } else if (order.selected_currency) {
                this.amount_currency = amount;
                this.amount = this.amount_currency * company_currency['rate'] / order.selected_currency['rate'];
                this.currency_id = order.selected_currency['id'];
            }
            this.trigger('change', this);
        },
        export_as_JSON: function () {
            var json = _super_paymentlinne.export_as_JSON.apply(this, arguments);
            if (this.currency_id) {
                json['currency_id'] = this.currency_id;
            }
            if (this.amount_currency) {
                json['amount_currency'] = this.amount_currency;
            }
            return json;
        },
        export_for_printing: function () {
            var json = _super_paymentlinne.export_for_printing.apply(this, arguments);
            if (this.currency_id) {
                json['currency_id'] = this.currency_id;
            }
            if (this.selected_currency) {
                json['selected_currency'] = this.selected_currency;
            }
            if (this.amount_currency) {
                json['amount_currency'] = this.amount_currency;
            }
            return json;
        },
        init_from_JSON: function (json) {
            var res = _super_paymentlinne.init_from_JSON.apply(this, arguments);
            if (json['currency_id']) {
                var company_currency = this.pos.currency_by_id[this.pos.currency['id']];
                this['selected_currency'] = this.pos.currency_by_id[json['currency_id']];
                this['amount_currency'] = round_di(this.amount * company_currency['rate'] / this['selected_currency']['rate'] || 0, this.pos.currency.decimals);
                this['currency_id'] = this.pos.currency_by_id[json['currency_id']]['id'];
            }
            return res;
        }
    });

    screens.PaymentScreenWidget.include({
        init: function (parent, options) {
            var self = this;
            this._super(parent, options);
            this.pos.bind('auto_update:paymentlines', function () {
                self.order_changes();
            });
            if (this.pos.config.keyboard_event) { // add Keycode 27, back screen
                this.keyboard_keydown_handler = function (event) {
                    if (event.keyCode === 8 || event.keyCode === 46 || event.keyCode === 27) { // Backspace and Delete
                        event.preventDefault();
                        self.keyboard_handler(event);
                    }
                };
                this.keyboard_handler = function (event) {
                    if (BarcodeEvents.$barcodeInput && BarcodeEvents.$barcodeInput.is(":focus")) {
                        return;
                    }
                    var key = '';
                    if (event.type === "keypress") {
                        if (event.keyCode === 32) { // Space
                            self.validate_order();
                        } else if (event.keyCode === 190 || // Dot
                            event.keyCode === 188 ||  // Comma
                            event.keyCode === 46) {  // Numpad dot
                            key = self.decimal_point;
                        } else if (event.keyCode >= 48 && event.keyCode <= 57) { // Numbers
                            key = '' + (event.keyCode - 48);
                        } else if (event.keyCode === 45) { // Minus
                            key = '-';
                        } else if (event.keyCode === 43) { // Plus
                            key = '+';
                        } else if (event.keyCode == 100) { // d: add credit
                            $('.add_credit').click();
                        } else if (event.keyCode == 102) { // f: pay full
                            $('.paid_full').click();
                        } else if (event.keyCode == 112) {  // p: partial paid
                            $('.paid_partial').click();
                        } else if (event.keyCode == 99) { // c: customer
                            $('.js_set_customer').click();
                        } else if (event.keyCode == 105) { // i: invoice
                            $('.js_invoice').click();
                        } else if (event.keyCode == 118) { // v: voucher
                            $('.input_voucher').click();
                            $('.js_create_voucher').click();
                        } else if (event.keyCode == 115) { // s: signature order
                            $('.js_signature_order').click();
                        } else if (event.keyCode == 110) { // n: note
                            $('.add_note').click();
                        } else if (event.keyCode == 109) { // n: note
                            $('.send_invoice_email').click();
                        } else if (event.keyCode == 119) { // w: note
                            $('.add_wallet').click();
                        }
                    } else { // keyup/keydown
                        if (event.keyCode === 46) { // Delete
                            key = 'CLEAR';
                        } else if (event.keyCode === 8) { // Backspace
                            key = 'BACKSPACE';
                        } else if (event.keyCode === 27) { // Backspace
                            self.gui.back();
                            self.pos.trigger('back:order');
                        }
                    }
                    self.payment_input(key);
                    event.preventDefault();
                };
            }
        },
        payment_input: function (input) {
            try {
                this._super(input);
            } catch (e) {
                this.reset_input();
            }
            var order = this.pos.get_order();
            if (order && !order.selected_paymentline) {
                var cashregister = this.pos.cashregisters[input];
                if (cashregister) {
                    var journal_id = cashregister.journal_id;
                    if (journal_id) {
                        this.click_paymentmethods(journal_id[0])
                    }
                }
            }
        },
        order_changes: function () {
            this._super();
            this.renderElement();
            var order = this.pos.get_order();
            if (!order) {
                return;
            } else if (order.is_paid()) {
                this.$('.next').addClass('highlight');
            } else {
                this.$('.next').removeClass('highlight');
            }
        },
        click_invoice: function () {
            this._super();
            var order = this.pos.get_order();
            if (order.is_to_invoice()) {
                this.$('.js_invoice').addClass('highlight');
            } else {
                this.$('.js_invoice').removeClass('highlight');
            }
        },
        customer_changed: function () { // when client change, email invoice auto change
            this._super();
            var client = this.pos.get_client();
            var $send_invoice_email = this.$('.send_invoice_email');
            if (client && client.email) {
                if ($send_invoice_email && $send_invoice_email.length) {
                    $send_invoice_email.text(client ? client.email : _t('N/A'));
                }
            } else {
                if ($send_invoice_email && $send_invoice_email.length) {
                    $send_invoice_email.text('Email N/A');
                }
            }
        },
        click_invoice_journal: function (journal_id) { // change invoice journal when create invoice
            var order = this.pos.get_order();
            order['invoice_journal_id'] = journal_id;
            this.$('.journal').removeClass('highlight');
            var $journal_selected = this.$("[journal-id='" + journal_id + "']");
            $journal_selected.addClass('highlight');
        },
        render_invoice_journals: function () { // render invoice journal, no use invoice journal default of pos
            var self = this;
            var methods = $(qweb.render('journal_list', {widget: this}));
            methods.on('click', '.journal', function () {
                self.click_invoice_journal($(this).data('id'));
            });
            return methods;
        },
        renderElement: function () {
            var self = this;
            if (this.pos.quickly_datas) {
                this.quickly_datas = this.pos.quickly_datas;
            } else {
                this.quickly_datas = []
            }
            this._super();
            if (this.pos.config.invoice_journal_ids && this.pos.config.invoice_journal_ids.length > 0 && this.pos.journals) {
                var methods = this.render_invoice_journals();
                methods.appendTo(this.$('.invoice_journals'));
            }
            var order = this.pos.get_order();
            if (!order) {
                return;
            }
            this.$('.select-currency').on('change', function (e) {
                var currency_id = parseInt($('.select-currency').val());
                var selected_currency = self.pos.currency_by_id[currency_id];
                var company_currency = self.pos.currency_by_id[self.pos.currency['id']];
                /*
                    Return action if have not selected currency or company currency is 0
                 */
                if (company_currency['rate'] != 1) {
                    return self.pos.gui.show_popup('dialog', {
                        title: _t('Warning'),
                        body: 'Your company currency rate is not 1, please set rate main currency is 1',
                    });
                }
                if (!selected_currency) {
                    return self.pos.gui.show_popup('dialog', {
                        title: _t('Warning'),
                        body: 'Please select currency need to payment',
                    });
                }
                order.selected_currency = selected_currency;
                var selected_paymentline = order.selected_paymentline;
                if (selected_paymentline) {
                    selected_paymentline.set_amount("0");
                    self.inputbuffer = "";
                } else {
                    order.add_paymentline(self.pos.cashregisters[0]);
                }
                self.add_currency_to_payment_line();
                self.render_paymentlines();
                order.trigger('change', order);
            });
            this.$('.update-rate').on('click', function (e) {
                var currency_id = parseInt($('.select-currency').val());
                var selected_currency = self.pos.currency_by_id[currency_id];
                self.selected_currency = selected_currency;
                if (selected_currency) {
                    self.hide();
                    self.gui.show_popup('textarea', {
                        title: _t('Input Rate'),
                        value: self.selected_currency['rate'],
                        confirm: function (rate) {
                            var selected_currency = self.selected_currency;
                            selected_currency['rate'] = parseFloat(rate);
                            self.show();
                            self.renderElement();
                            var params = {
                                name: new Date(),
                                currency_id: self.selected_currency['id'],
                                rate: parseFloat(rate),
                            };
                            return rpc.query({
                                model: 'res.currency.rate',
                                method: 'create',
                                args:
                                    [params],
                                context: {}
                            }).then(function (rate_id) {
                                return rate_id;
                            }).then(function () {
                                self.gui.close_popup();
                            }).fail(function (type, error) {
                                if (error.code === 200) {
                                    event.preventDefault();
                                    self.gui.show_popup('dialog', {
                                        'title': _t('!!! ERROR !!!'),
                                        'body': error.data.message,
                                    });
                                }
                            });
                        },
                        cancel: function () {
                            self.show();
                            self.renderElement();
                        }
                    });
                }
            });
            this.$('.add_note').click(function () { // Button add Note
                var order = self.pos.get_order();
                if (order) {
                    self.hide();
                    self.gui.show_popup('textarea', {
                        title: _t('Add Order Note'),
                        value: order.get_note(),
                        confirm: function (note) {
                            order.set_note(note);
                            order.trigger('change', order);
                            self.show();
                            self.renderElement();
                        },
                        cancel: function () {
                            self.show();
                            self.renderElement();
                        }
                    });
                }
            });
            this.$('.js_signature_order').click(function () { // Signature on Order
                var order = self.pos.get_order();
                self.hide();
                self.gui.show_popup('popup_order_signature', {
                    order: order,
                    confirm: function (rate) {
                        self.show();
                    },
                    cancel: function () {
                        self.show();
                    }
                });

            });
            this.$('.paid_full').click(function () { // payment full
                var order = self.pos.get_order();
                var selected_paymentline = order.selected_paymentline;
                var register = _.find(self.pos.cashregisters, function (register) {
                    return register['journal']['pos_method_type'] == 'default';
                });
                if (register) {
                    if (!selected_paymentline) {
                        order.add_paymentline(register);
                        selected_paymentline = order.selected_paymentline;
                    }
                    selected_paymentline.set_amount(0);
                    var amount_due = order.get_due();
                    selected_paymentline.set_amount(amount_due);
                    self.order_changes();
                    self.render_paymentlines();
                    self.$('.paymentline.selected .edit').text(self.format_currency_no_symbol(amount_due));
                }
            });
            this.$('.paid_partial').click(function () { // partial payment
                var order = self.pos.get_order();
                order.partial_payment = true;
                self.pos.push_order(order);
                self.gui.show_screen('receipt');
            });
            this.$('.add_team').click(function () { // add team
                self.hide();
                var list = [];
                for (var i = 0; i < self.pos.bus_locations.length; i++) {
                    var bus = self.pos.bus_locations[i];
                    list.push({
                        'label': bus['user_id'][1] + '/' + bus['name'],
                        'item': bus
                    })
                }
                return self.gui.show_popup('selection', {
                    title: _t('Select sale lead'),
                    list: list,
                    confirm: function (bus) {
                        var user_id = bus['user_id'][0];
                        var user = self.pos.user_by_id[user_id];
                        var order = self.pos.get_order();
                        if (user && order) {
                            self.pos.db.set_cashier(user);
                            self.pos.bus_location = bus;
                            order.trigger('change');
                        }
                        self.show();
                        self.renderElement();
                    },
                    cancel: function () {
                        self.show();
                        self.renderElement();
                    }
                });
            });
            this.$('.add_wallet').click(function () { // add change amount to wallet card
                self.hide();
                var order = self.pos.get_order();
                var change = order.get_change();
                var wallet_register = _.find(self.pos.cashregisters, function (cashregister) {
                    return cashregister.journal['pos_method_type'] == 'wallet';
                });
                if (order && !order.get_client()) {
                    self.pos.gui.show_screen('clientlist');
                    return self.pos.gui.show_popup('dialog', {
                        title: _t('Warning'),
                        body: 'Please select customer the first'
                    });
                }
                if (!change || change == 0) {
                    return self.pos.gui.show_popup('confirm', {
                        title: _t('Warning'),
                        body: _t('Order change empty'),
                        cancel: function () {
                            self.show();
                            self.renderElement();
                            self.order_changes();
                            return self.pos.gui.close_popup();
                        },
                        confirm: function () {
                            self.show();
                            self.renderElement();
                            self.order_changes();
                            return self.pos.gui.close_popup();
                        }
                    });
                }
                if (!wallet_register) {
                    return self.pos.gui.show_popup('dialog', {
                        title: _t('Warning'),
                        body: 'Wallet journal is missing inside your system',
                    });
                }
                if (order.finalized == false) {
                    self.gui.show_popup('number', {
                        'title': _t('Add to customer wallet'),
                        'value': change,
                        'confirm': function (value) {
                            if (value <= order.get_change()) {
                                var wallet_paymentline = new models.Paymentline({}, {
                                    order: order,
                                    cashregister: wallet_register,
                                    pos: self.pos
                                });
                                wallet_paymentline.set_amount(-value);
                                order.paymentlines.add(wallet_paymentline);
                                order.trigger('change', order);
                            }
                            self.show();
                            self.renderElement();
                            self.order_changes();
                        },
                        cancel: function () {
                            self.show();
                            self.renderElement();
                        }
                    });
                }
            });
            this.$('.add_credit').click(function () { // add return amount to credit card
                var order = self.pos.get_order();
                order.add_order_credit();
            });
            this.$('.quickly-payment').click(function () { // Quickly Payment
                self.pos.cashregisters = self.pos.cashregisters.sort(function (a, b) {
                    return a.id - b.id;
                });
                var quickly_payment_id = parseInt($(this).data('id'));
                var quickly_payment = self.pos.quickly_payment_by_id[quickly_payment_id];
                var order = self.pos.get_order();
                var paymentlines = order.get_paymentlines();
                var open_paymentline = false;
                for (var i = 0; i < paymentlines.length; i++) {
                    if (!paymentlines[i].paid) {
                        open_paymentline = true;
                    }
                }
                if (self.pos.cashregisters.length == 0) {
                    return;
                }
                if (!open_paymentline) {
                    var register_random = _.find(self.pos.cashregisters, function (register) {
                        return register['journal']['pos_method_type'] == 'default';
                    });
                    if (register_random) {
                        order.add_paymentline(register_random);
                    } else {
                        return;
                    }
                }
                if (quickly_payment && order.selected_paymentline) {
                    var money = quickly_payment['amount'] + order.selected_paymentline['amount']
                    order.selected_paymentline.set_amount(money);
                    self.order_changes();
                    self.render_paymentlines();
                    self.$('.paymentline.selected .edit').text(self.format_currency_no_symbol(money));
                }
            });
            this.$('.send_invoice_email').click(function () { // input email send invoice
                var order = self.pos.get_order();
                var client = order.get_client();
                if (client) {
                    if (client.email) {
                        var email_invoice = order.is_email_invoice();
                        order.set_email_invoice(!email_invoice);
                        if (order.is_email_invoice()) {
                            self.$('.send_invoice_email').addClass('highlight');
                            if (!order.to_invoice) {
                                self.$('.js_invoice').click();
                            }
                        } else {
                            self.$('.send_invoice_email').removeClass('highlight');
                            if (order.to_invoice) {
                                self.$('.js_invoice').click();
                            }
                        }
                    } else {
                        self.pos.gui.show_screen('clientlist');
                        return self.pos.gui.show_popup('dialog', {
                            title: 'Warning',
                            body: 'Customer email is blank, please update'
                        })
                    }

                } else {
                    self.pos.gui.show_screen('clientlist');
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Please select client the first'
                    })
                }
            });
        },
        add_currency_to_payment_line: function (line) {
            var order = this.pos.get_order();
            line = order.selected_paymentline;
            line.selected_currency = order.selected_currency;
        },
        click_paymentmethods: function (id) {
            // id : id of journal
            var self = this;
            this._super(id);
            var order = this.pos.get_order();
            var selected_paymentline = order.selected_paymentline;
            var client = order.get_client();

            // if credit, wallet: require choose client the first
            if (selected_paymentline && selected_paymentline.cashregister && selected_paymentline.cashregister.journal['pos_method_type'] && (selected_paymentline.cashregister.journal['pos_method_type'] == 'wallet' || selected_paymentline.cashregister.journal['pos_method_type'] == 'credit') && !client) {
                self.pos.gui.show_screen('clientlist');
                self.pos.gui.show_popup('dialog', {
                    title: 'Warning',
                    body: 'Required add client for this method just selected'
                })
            }
            if (order.is_return && selected_paymentline) {
                var amount_total = order.get_total_with_tax();
                selected_paymentline.set_amount(amount_total);
                this.order_changes();
                this.render_paymentlines();
                this.$('.paymentline.selected .edit').text(this.format_currency_no_symbol(amount_total));
            }
        },
        validate_order: function (force_validation) {
            var order = this.pos.get_order();
            if (order.is_return) {
                if (order.paymentlines.models.length == 0) {
                    return this.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Please choose payment method, before submit order'
                    })
                }
            }
            var wallet = 0;
            var use_wallet = false;
            var credit = 0;
            var use_credit = false;
            var payments_lines = order.paymentlines.models;
            var client = this.pos.get_order().get_client();
            if (client) {
                for (var i = 0; i < payments_lines.length; i++) {
                    var payment_line = payments_lines[i];
                    if (payment_line.cashregister.journal['pos_method_type'] && payment_line.cashregister.journal['pos_method_type'] == 'wallet') {
                        wallet += payment_line.get_amount();
                        use_wallet = true;
                    }
                    if (payment_line.cashregister.journal['pos_method_type'] && payment_line.cashregister.journal['pos_method_type'] == 'credit') {
                        credit += payment_line.get_amount();
                        use_credit = true;
                    }
                }
                if (client['wallet'] < wallet && use_wallet == true) {
                    return this.pos.gui.show_popup('dialog', {
                        title: _t('Warning'),
                        body: 'Wallet amount of customer only ' + this.pos.chrome.format_currency(client['wallet']) + '. You can set payment line amount bigger than ' + this.pos.chrome.format_currency(client['wallet'])
                    })
                }
                if (!order.is_return && (client['balance'] - credit < 0) && use_credit == true) {
                    return this.pos.gui.show_popup('dialog', {
                        title: _t('Error'),
                        body: 'Credit amount of customer have only ' + this.pos.chrome.format_currency(client['balance']) + '. You can set payment line amount bigger than ' + this.pos.chrome.format_currency(client['balance'])
                    })
                }
            }
            var res = this._super(force_validation);
            return res;
        }
    });
});
