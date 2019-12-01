"use strict";
odoo.define('pos_retail.screen_pos_orders', function (require) {

    var models = require('point_of_sale.models');
    var screens = require('point_of_sale.screens');
    var core = require('web.core');
    var _t = core._t;
    var gui = require('point_of_sale.gui');
    var rpc = require('pos.rpc');
    var qweb = core.qweb;
    var PopupWidget = require('point_of_sale.popups');

    var popup_return_pos_order_lines = PopupWidget.extend({
        template: 'popup_return_pos_order_lines',
        show: function (options) {
            var self = this;
            this.line_selected = [];
            var order_lines = options.order_lines;
            for (var i = 0; i < order_lines.length; i++) {
                var line = order_lines[i];
                this.line_selected.push(line);
            }
            this.order = options.order;
            this._super(options);
            var image_url = window.location.origin + '/web/image?model=product.product&field=image_medium&id=';
            if (order_lines) {
                self.$el.find('tbody').html(qweb.render('return_pos_order_line', {
                    order_lines: order_lines,
                    image_url: image_url,
                    widget: self
                }));
                this.$('.line-select').click(function () {
                    var line_id = parseInt($(this).data('id'));
                    var line = self.pos.db.order_line_by_id[line_id];
                    var checked = this.checked;
                    if (checked == false) {
                        for (var i = 0; i < self.line_selected.length; ++i) {
                            if (self.line_selected[i].id == line.id) {
                                self.line_selected.splice(i, 1);
                            }
                        }
                    } else {
                        self.line_selected.push(line);
                    }
                });
                this.$('.confirm_return_order').click(function () {
                    if (self.line_selected == [] || !self.order) {
                        self.pos.gui.show_popup('dialog', {
                            title: _t('Error'),
                            body: 'Please select lines need return from request of customer',
                        });
                    } else {
                        self.pos.add_return_order(self.order, self.line_selected);
                        return self.pos.gui.show_screen('payment');
                    }
                });
                this.$('.create_voucher').click(function () { // create voucher when return order
                    if (self.line_selected == [] || !self.order) {
                        self.pos.gui.show_popup('dialog', {
                            title: _t('Error'),
                            body: 'Please select lines need return',
                        });
                    } else {
                        var order = new models.Order({}, {pos: self.pos});
                        order['create_voucher'] = true;
                        self.pos.gui.show_screen('payment');
                        order['is_return'] = true;
                        self.pos.get('orders').add(order);
                        self.pos.set('selectedOrder', order);
                        for (var i = 0; i < self.line_selected.length; i++) {
                            var line_return = self.line_selected[i];
                            var product_id = line_return['product_id'][0];
                            var product = self.pos.db.get_product_by_id(product_id);
                            if (product) {
                                var line = new models.Orderline({}, {pos: self.pos, order: order, product: product});
                                line['is_return'] = true;
                                order.orderlines.add(line);
                                var price_unit = line_return['price_unit'];
                                line.set_unit_price(price_unit);
                                line.set_quantity(-line_return['qty'], 'keep price');
                            }
                        }
                        return self.gui.show_screen('payment');

                    }

                });
                this.$('.cancel').click(function () {
                    self.pos.gui.close_popup();
                });
                this.$('.qty_minus').click(function () {
                    var line_id = parseInt($(this).data('id'));
                    var line = self.pos.db.order_line_by_id[line_id];
                    var quantity = parseFloat($(this).parent().find('.qty').text());
                    if (quantity > 1) {
                        var new_quantity = quantity - 1;
                        $(this).parent().find('.qty').text(new_quantity);
                        line['new_quantity'] = new_quantity;
                    }
                });
                this.$('.qty_plus').click(function () {
                    var line_id = parseInt($(this).data('id'));
                    var line = self.pos.db.order_line_by_id[line_id];
                    var quantity = parseFloat($(this).parent().find('.qty').text());
                    if (line['qty'] >= (quantity + 1)) {
                        var new_quantity = quantity + 1;
                        $(this).parent().find('.qty').text(new_quantity);
                        line['new_quantity'] = new_quantity;
                    }
                })
            }
        }
    });
    gui.define_popup({
        name: 'popup_return_pos_order_lines',
        widget: popup_return_pos_order_lines
    });

    var pos_orders_screen = screens.ScreenWidget.extend({
        template: 'pos_orders_screen',
        init: function (parent, options) {
            var self = this;
            this.reverse = true;
            this._super(parent, options);
            this.pos.bind('refresh:pos_orders_screen', function () {
                self.render_pos_order_list(self.pos.db.get_pos_orders(1000));
                self.hide_order_selected();
            }, this);
        },
        show: function () {
            this._super();
            this.renderElement();
            if (this.order_selected) {
                this.display_pos_order_detail(this.order_selected);
            }
        },
        refresh_screen: function () {
            var self = this;
            self.pos.get_modifiers_backend('pos.order').then(function () {
                self.pos.get_modifiers_backend('pos.order.line').then(function () {
                    self.pos.trigger('refresh:pos_orders_screen');
                });
            });
        },
        renderElement: function () {
            var self = this;
            this._super();
            this.$('.back').click(function () {
                self.gui.show_screen('products');
            });
            this.$('.only_partial_payment_orders').click(function () {
                var orders = _.filter(self.pos.db.get_pos_orders(), function (order) {
                    return order.state == 'partial_payment';
                });
                if (orders) {
                    return self.render_pos_order_list(orders);
                } else {
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Have not any partial payment orders'
                    })
                }
            });
            this.$('.button_sync').click(function () {
                self.refresh_screen()
            });
            var $search_box = this.$('.searchbox >input');
            if ($search_box) {
                $search_box.autocomplete({
                    source: this.pos.db.get_pos_orders_source(),
                    minLength: this.pos.config.min_length_search,
                    select: function (event, ui) {
                        if (ui && ui['item'] && ui['item']['value']) {
                            var order = self.pos.db.order_by_id[ui['item']['value']];
                            self.display_pos_order_detail(order);
                            setTimeout(function () {
                                self.$('.searchbox input')[0].value = '';
                                self.$('.searchbox input').focus();
                            }, 1000);

                        }
                    }
                });
            }
            var input = this.el.querySelector('.searchbox input');
            input.value = '';
            input.focus();
            this.render_pos_order_list(this.pos.db.get_pos_orders(1000));
            this.$('.client-list-contents').delegate('.pos_order_row', 'click', function (event) {
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
            });
            this.$('.searchbox .search-clear').click(function () {
                self.clear_search();
            });
            this.sort_orders();
        },
        sort_orders: function () {
            var self = this;
            this.$('.sort_by_create_date').click(function () {
                var orders = self.pos.db.get_pos_orders().sort(self.pos.sort_by('create_date', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase()
                }));
                self.render_pos_order_list(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_pos_order_id').click(function () {
                var orders = self.pos.db.get_pos_orders().sort(self.pos.sort_by('id', self.reverse, parseInt));
                self.render_pos_order_list(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_pos_order_amount_total').click(function () {
                var orders = self.pos.db.get_pos_orders().sort(self.pos.sort_by('amount_total', self.reverse, parseInt));
                self.render_pos_order_list(orders);
                self.reverse = !self.reverse;

            });
            this.$('.sort_by_pos_order_amount_paid').click(function () {
                var orders = self.pos.db.get_pos_orders().sort(self.pos.sort_by('amount_paid', self.reverse, parseInt));
                self.render_pos_order_list(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_pos_order_amount_tax').click(function () {
                var orders = self.pos.db.get_pos_orders().sort(self.pos.sort_by('amount_tax', self.reverse, parseInt));
                self.render_pos_order_list(orders);
                self.reverse = !self.reverse;

            });
            this.$('.sort_by_pos_order_name').click(function () {
                var orders = self.pos.db.get_pos_orders().sort(self.pos.sort_by('name', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase()
                }));
                self.render_pos_order_list(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_pos_order_partner_name').click(function () {
                var orders = self.pos.db.get_pos_orders().sort(self.pos.sort_by('partner_name', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase()
                }));
                self.render_pos_order_list(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_pos_order_barcode').click(function () {
                var orders = self.pos.db.get_pos_orders().sort(self.pos.sort_by('ean13', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase();
                }));
                self.render_pos_order_list(orders);
                self.reverse = !self.reverse;
            });
            this.$('.sort_by_pos_order_state').click(function () {
                var orders = self.pos.db.get_pos_orders().sort(self.pos.sort_by('state', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase();
                }));
                self.render_pos_order_list(orders);
                self.reverse = !self.reverse;
            });
        },
        clear_search: function () {
            this.render_pos_order_list(this.pos.db.get_pos_orders());
            this.$('.searchbox input')[0].value = '';
            this.$('.searchbox input').focus();
            this.display_pos_order_detail(null);
        },
        perform_search: function (query, associate_result) {
            var orders;
            if (query) {
                orders = this.pos.db.search_order(query);
                if (associate_result && orders.length === 1) {
                    return this.display_pos_order_detail(orders[0]);
                }
                return this.render_pos_order_list(orders);

            } else {
                orders = this.pos.db.get_pos_orders();
                return this.render_pos_order_list(orders);
            }
        },
        partner_icon_url: function (id) {
            return '/web/image?model=res.partner&id=' + id + '&field=image_small';
        },
        order_select: function (event, $order, id) {
            var order = this.pos.db.order_by_id[id];
            this.$('.client-line').removeClass('highlight');
            $order.addClass('highlight');
            this.display_pos_order_detail(order);
        },
        render_pos_order_list: function (orders) {
            var contents = this.$el[0].querySelector('.pos_order_list');
            contents.innerHTML = "";
            for (var i = 0, len = Math.min(orders.length, 1000); i < len; i++) {
                var order = orders[i];
                var pos_order_row_html = qweb.render('pos_order_row', {widget: this, order: order});
                var pos_order_row = document.createElement('tbody');
                pos_order_row.innerHTML = pos_order_row_html;
                pos_order_row = pos_order_row.childNodes[1];
                if (order === this.order_selected) {
                    pos_order_row.classList.add('highlight');
                } else {
                    pos_order_row.classList.remove('highlight');
                }
                contents.appendChild(pos_order_row);
            }
        },
        hide_order_selected: function () { // hide when re-print receipt
            var contents = this.$('.pos_detail');
            contents.empty();
            this.order_selected = null;

        },
        display_pos_order_detail: function (order) {
            var contents = this.$('.pos_detail');
            contents.empty();
            var self = this;
            this.order_selected = order;
            if (!order) {
                return;
            }
            var $row_selected = this.$("[data-id='" + order['id'] + "']");
            $row_selected.addClass('highlight');
            order['link'] = window.location.origin + "/web#id=" + order.id + "&view_type=form&model=pos.order";
            contents.append($(qweb.render('pos_order_detail', {widget: this, order: order})));
            var lines = order.lines;
            if (lines) {
                var line_contents = this.$('.lines_detail');
                line_contents.empty();
                line_contents.append($(qweb.render('pos_order_lines', {widget: this, lines: lines})));
            }
            ;
            this.$('.return_order').click(function () {
                var order = self.order_selected;
                var order_lines = order.lines;
                if (!order_lines) {
                    return self.gui.show_popup('dialog', {
                        title: 'Warning',
                        body: 'Order empty lines',
                    });
                } else {
                    return self.gui.show_popup('popup_return_pos_order_lines', {
                        order_lines: order_lines,
                        order: order
                    });
                }
            });
            this.$('.register_amount').click(function () {
                var pos_order = self.order_selected;
                if (pos_order) {
                    self.gui.show_popup('popup_register_payment', {
                        pos_order: pos_order
                    })
                }
            });
            this.$('.create_invoice').click(function () {
                var pos_order = self.order_selected;
                if (pos_order) {
                    return self.gui.show_popup('confirm', {
                        title: 'Create invoice ?',
                        body: 'Are you want create invoice for ' + pos_order['name'] + ' ?',
                        confirm: function () {
                            self.pos.gui.close_popup();
                            return rpc.query({
                                model: 'pos.order',
                                method: 'made_invoice',
                                args:
                                    [[pos_order['id']]],
                                context: {
                                    pos: true
                                }
                            }).then(function (invoice_vals) {
                                self.link = window.location.origin + "/web#id=" + invoice_vals[0]['id'] + "&view_type=form&model=account.invoice";
                                return self.gui.show_popup('confirm', {
                                    title: 'Are you want open invoice?',
                                    body: 'Invoice created',
                                    confirmButtonText: 'Yes',
                                    cancelButtonText: 'Close',
                                    confirm: function () {
                                        window.open(self.link, '_blank');
                                    },
                                    cancel: function () {
                                        self.pos.gui.close_popup();
                                    }
                                });
                            }).fail(function (type, error) {
                                return self.pos.query_backend_fail(type, error);
                            });
                        },
                        cancel: function () {
                            return self.pos.gui.close_popup();
                        }
                    });
                }
            });
            this.$('.reprint_order').click(function () {
                var order = self.order_selected;
                if (!order) {
                    return;
                }
                var lines = order.lines;
                if (!lines.length) {
                    return self.pos.gui.show_popup('dialog', {
                        title: 'WARNING',
                        body: 'Order blank lines',
                    });
                } else {
                    var new_order = new models.Order({}, {pos: self.pos, temporary: true});
                    new_order['ean13'] = order['ean13'];
                    new_order['name'] = order['name'];
                    new_order['date_order'] = order['date_order'];
                    var partner = order['partner_id'];
                    if (partner) {
                        var partner_id = partner[0];
                        var partner = self.pos.db.get_partner_by_id(partner_id);
                        new_order.set_client(partner);
                    }
                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i];
                        var product = self.pos.db.get_product_by_id(line.product_id[0]);
                        if (!product) {
                            continue
                        } else {
                            var new_line = new models.Orderline({}, {
                                pos: self.pos,
                                order: new_order,
                                product: product
                            });
                            new_line.set_quantity(line.qty, 'keep price, for re-print receipt');
                            new_order.orderlines.add(new_line);
                            if (line.discount) {
                                new_line.set_discount(line.discount);
                            }
                            if (line.discount_reason) {
                                new_line.discount_reason = line.discount_reason;
                            }
                            if (line.promotion) {
                                new_line.promotion = line.promotion;
                            }
                            if (line.promotion_reason) {
                                new_line.promotion_reason = line.promotion_reason;
                            }
                            if (line.note) {
                                new_line.set_line_note(line.note);
                            }
                            if (line.plus_point) {
                                new_line.plus_point = line.plus_point;
                            }
                            if (line.redeem_point) {
                                new_line.redeem_point = line.redeem_point;
                            }
                            if (line.uom_id) {
                                var uom_id = line.uom_id[0];
                                var uom = self.pos.uom_by_id[uom_id];
                                if (uom) {
                                    new_line.set_unit(line.product_uom[0]);
                                }
                            }
                            if (line.notice) {
                                new_line.notice = line.notice;
                            }
                            new_line.set_unit_price(line.price_unit);
                        }
                    }
                    var orders = self.pos.get('orders');
                    orders.add(new_order);
                    self.pos.set('selectedOrder', new_order);
                    return self.pos.gui.show_screen('receipt');

                }
            });
            this.$('.action_pos_order_cancel').click(function () {
                var order = self.order_selected;
                self.pos.gui.show_popup('confirm', {
                    title: 'Warning',
                    body: 'Are you sure cancel order ' + order['name'] + ' ?',
                    confirm: function () {
                        return rpc.query({
                            model: 'pos.order',
                            method: 'action_pos_order_cancel',
                            args:
                                [[self.order_selected['id']]],
                            context: {
                                pos: true
                            }
                        }).then(function () {
                            self.display_pos_order_detail(null);
                            self.pos.gui.show_popup('dialog', {
                                title: 'Done',
                                body: 'Order just processed to cancel'
                            });
                            var orders = _.filter(self.pos.db.get_pos_orders(), function (order) {
                                return order['state'] != 'paid' && order['state'] != 'done' && order['state'] != 'invoiced' && order['state'] != 'cancel'
                            });
                            self.render_pos_order_list(orders);
                            return self.pos.gui.close_popup();
                        }).fail(function (type, error) {
                            return self.pos.query_backend_fail(type, error);
                        })
                    },
                    cancel: function () {
                        return self.pos.gui.close_popup();
                    }
                })
            })
        }
    });
    gui.define_screen({name: 'pos_orders_screen', widget: pos_orders_screen});
});
