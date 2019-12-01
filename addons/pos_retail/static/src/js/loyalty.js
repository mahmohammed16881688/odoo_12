"use strict";
odoo.define('pos_retail.loyalty', function (require) {

    var core = require('web.core');
    var _t = core._t;
    var utils = require('web.utils');
    var round_pr = utils.round_precision;
    var models = require('point_of_sale.models');
    var screens = require('point_of_sale.screens');
    var model_retail = require('pos_retail.order')

    var _super_PosModel = models.PosModel.prototype;
    models.PosModel = models.PosModel.extend({
        initialize: function (session, attributes) {
            var partner_model = this.get_model('res.partner');
            partner_model.fields.push(
                'pos_loyalty_point',
                'pos_loyalty_type'
            );
            return _super_PosModel.initialize.apply(this, arguments);
        },
        _save_to_server: function (orders, options) {
            for (var i = 0; i < orders.length; i++) {
                var order = orders[i];
                if ((order.data.plus_point || order.data.redeem_point) && order.data.partner_id) {
                    var customer = this.db.get_partner_by_id(order.data.partner_id)
                    if (order.data.plus_point != undefined) {
                        customer['pos_loyalty_point'] += order.data.plus_point;
                    }
                    if (order.data.redeem_point != undefined) {
                        customer['pos_loyalty_point'] -= order.data.redeem_point;
                    }
                    this.db.partner_by_id[order.data.partner_id] = customer;
                }
            }
            return _super_PosModel._save_to_server.call(this, orders, options);
        }
    });

    var reward_button = screens.ActionButtonWidget.extend({
        template: 'reward_button',
        set_redeem_point: function (line, new_price, point) {
            line.redeem_point = round_pr(point, this.pos.loyalty.rounding)
            line.plus_point = 0;
            if (new_price != null) {
                line.price = new_price;
            }
            line.trigger_update_line();
            line.trigger('change', line);
            line.order.trigger('change', line.order)
        },
        button_click: function () {
            var list = [];
            var self = this;
            var order = self.pos.get('selectedOrder');
            var client = order.get_client();
            if (!client) {
                return setTimeout(function () {
                    self.pos.gui.show_screen('clientlist');
                }, 1);
            }
            for (var i = 0; i < this.pos.rewards.length; i++) {
                var item = this.pos.rewards[i];
                list.push({
                    'label': item['name'],
                    'item': item
                });
            }
            if (list.length > 0) {
                this.gui.show_popup('selection', {
                    title: _t('Please select Reward program'),
                    list: list,
                    confirm: function (reward) {
                        var loyalty = self.pos.loyalty;
                        if (!loyalty) {
                            return;
                        }
                        var product = self.pos.db.get_product_by_id(loyalty.product_loyalty_id[0]);
                        if (!product) {
                            return;
                        }
                        var order = self.pos.get('selectedOrder');
                        var applied = false;
                        var lines = order.orderlines.models;
                        if (lines.length == 0) {
                            return;
                        }
                        var total_with_tax = order.get_total_with_tax();
                        var redeem_point_used = order.build_redeem_point();
                        var client = order.get_client();
                        if (reward['min_amount'] > total_with_tax) {
                            return self.pos.gui.show_popup('dialog', {
                                title: 'Warning',
                                body: 'Reward ' + reward['name'] + ' required min amount bigger than ' + reward['min_amount'],
                            })
                        }
                        if (client['pos_loyalty_point'] <= redeem_point_used) {
                            return self.pos.gui.show_popup('dialog', {
                                title: 'Warning',
                                body: 'Point of customer not enough',
                            })
                        }
                        if ((reward['type'] == 'discount_products' || reward['type'] == 'discount_categories') && (reward['discount'] <= 0 || reward['discount'] > 100)) {
                            return self.pos.gui.show_popup('dialog', {
                                title: 'Warning',
                                body: 'Reward discount required set discount bigger or equal 0 and smaller or equal 100'
                            })
                        }
                        if (reward['type'] == 'discount_products') {
                            var point_redeem = 0;
                            var amount_total = 0;
                            for (var i = 0; i < lines.length; i++) {
                                var line = lines[i];
                                if (reward['discount_product_ids'].indexOf(line['product']['id']) != -1) {
                                    amount_total += line.get_price_with_tax();
                                }
                            }
                            var point_will_redeem = amount_total * reward['discount'] / 100  / reward['coefficient'];
                            var price_discount = amount_total * reward['discount'] / 100 ;
                            if ((client['pos_loyalty_point'] > (point_will_redeem + redeem_point_used)) && price_discount) {
                                applied = true;
                                order.add_product(product, {
                                    price: price_discount,
                                    quantity: - 1,
                                    merge: false,
                                    extras: {
                                        reward_id: reward.id,
                                        redeem_point: point_will_redeem
                                    }
                                });
                            }
                        }
                        else if (reward['type'] == 'discount_categories') {
                            var point_redeem = 0;
                            var amount_total = 0;
                            for (var i = 0; i < lines.length; i++) {
                                var line = lines[i];
                                if (reward['discount_category_ids'].indexOf(line['product']['pos_categ_id'][0]) != -1) {
                                    amount_total += line.get_price_with_tax();
                                }
                            }
                            var point_will_redeem = amount_total * reward['discount'] / 100  / reward['coefficient'];
                            var price_discount = amount_total * reward['discount'] / 100 ;
                            if ((client['pos_loyalty_point'] > (point_will_redeem + redeem_point_used)) && price_discount) {
                                applied = true;
                                order.add_product(product, {
                                    price: price_discount,
                                    quantity: -1,
                                    merge: false,
                                    extras: {
                                        reward_id: reward.id,
                                        redeem_point: point_will_redeem
                                    }
                                });
                            }
                        }
                        else if (reward['type'] == 'gift') {
                            for (var item_index in reward['gift_product_ids']) {
                                var product_gift = self.pos.db.get_product_by_id(reward['gift_product_ids'][item_index]);
                                if (product_gift) {
                                    var point_will_redeem = product_gift['list_price'] * reward['coefficient'];
                                    if (client['pos_loyalty_point'] > (point_will_redeem + redeem_point_used)) {
                                        applied = true;
                                        order.add_product(product_gift, {
                                            price: 0,
                                            quantity: reward['quantity'],
                                            merge: false,
                                            extras: {
                                                reward_id: reward.id,
                                                redeem_point: point_will_redeem
                                            }
                                        });
                                    }
                                }
                            }
                        }
                        else if (reward['type'] == 'resale' && reward['price_resale'] > 0) {
                            var point_redeem = 0;
                            var amount_total = 0;
                            for (var i = 0; i < lines.length; i++) {
                                var line = lines[i];
                                if (reward['resale_product_ids'].indexOf(line['product']['id']) != -1) {
                                    amount_total += (line.get_price_with_tax() / line.quantity - reward['price_resale']) * line.quantity;
                                }
                            }
                            var point_will_redeem = amount_total * reward['coefficient'];
                            if (client['pos_loyalty_point'] > (point_will_redeem + redeem_point_used)) {
                                applied = true;
                                order.add_product(product, {
                                    price: amount_total,
                                    quantity: -1,
                                    merge: false,
                                    extras: {
                                        reward_id: reward.id,
                                        redeem_point: point_will_redeem
                                    }
                                });
                            }
                        }
                        else if (reward['type'] == 'use_point_payment') {
                            return self.gui.show_popup('number', {
                                'title': _t('Input client point need to use ?'),
                                'value': self.format_currency_no_symbol(0),
                                'confirm': function (point) {
                                    point = parseFloat(point);
                                    var redeem_point_used = order.build_redeem_point();
                                    var next_redeem_point = redeem_point_used + point;
                                    if (point <= 0) {
                                        return self.pos.gui.close_popup();
                                    }
                                    if (client['pos_loyalty_point'] < next_redeem_point) {
                                        return self.pos.gui.show_popup('dialog', {
                                            title: _t('Warning'),
                                            body: "Could not apply bigger than client's point " + client['pos_loyalty_point'],
                                        })

                                    } else {
                                        var loyalty = self.pos.loyalty;
                                        if (loyalty) {
                                            var next_amount = total_with_tax - (point * reward['coefficient']);
                                            if (next_amount >= 0) {
                                                applied = true;
                                                order.add_product(product, {
                                                    price: point * reward['coefficient'],
                                                    quantity: -1,
                                                    merge: false,
                                                    extras: {
                                                        reward_id: reward.id,
                                                        redeem_point: point
                                                    },
                                                });
                                            } else {
                                                return self.gui.show_popup('dialog', {
                                                    title: 'Warning',
                                                    body: 'Max point can add is ' + (total_with_tax * reward['coefficient']),
                                                });
                                            }
                                        }
                                    }
                                }
                            });
                        }
                        if (applied) {
                            order.trigger('change', order);
                            return self.gui.show_popup('dialog', {
                                title: 'Succeed',
                                body: 'Order applied reward succeed',
                                color: 'info',
                            });
                        } else {
                            return self.gui.show_popup('dialog', {
                                title: 'Warning',
                                body: 'Client point have point smaller than reward point need',
                            });
                        }
                    }
                });
            } else {
                return this.gui.show_popup('dialog', {
                    title: 'ERROR',
                    body: 'Have not any reward programs active',
                });
            }
        }
    });

    screens.define_action_button({
        'name': 'reward_button',
        'widget': reward_button,
        'condition': function () {
            return this.pos.loyalty && this.pos.rules && this.pos.rules.length && this.pos.rules.length > 0;
        }
    });

    var _super_Order = models.Order.prototype;
    models.Order = models.Order.extend({
        initialize: function (attributes, options) {
            _super_Order.initialize.apply(this, arguments);
            if (!this.plus_point) {
                this.plus_point = 0;
            }
            if (!this.redeem_point) {
                this.redeem_point = 0;
            }
        },
        init_from_JSON: function (json) {
            var res = _super_Order.init_from_JSON.apply(this, arguments);
            if (json.plus_point) {
                this.plus_point = json.plus_point;
            }
            if (json.redeem_point) {
                this.redeem_point = json.redeem_point;
            }
            return res;
        },
        export_as_JSON: function () {
            var json = _super_Order.export_as_JSON.apply(this, arguments);
            if (this.plus_point) {
                json.plus_point = this.plus_point;
            }
            if (this.redeem_point) {
                json.redeem_point = this.redeem_point;
            }
            return json;
        },
        export_for_printing: function () {
            var receipt = _super_Order.export_for_printing.call(this);
            receipt.plus_point = this.plus_point || 0;
            receipt.redeem_point = this.redeem_point || 0;
            return receipt
        },
        build_plus_point: function () {
            var total_point = 0;
            var lines = this.orderlines.models;
            if (lines.length == 0 || !lines) {
                return total_point;
            }
            var loyalty = this.pos.loyalty;
            if (!loyalty) {
                return total_point;
            }
            var rules = [];
            var rules_by_loylaty_id = this.pos.rules_by_loyalty_id[loyalty.id]
            if (!rules_by_loylaty_id) {
                return total_point;
            }
            for (var j = 0; j < rules_by_loylaty_id.length; j++) {
                rules.push(rules_by_loylaty_id[j]);
            }
            if (!rules) {
                return total_point;
            }
            if (rules.length) {
                for (var j = 0; j < lines.length; j++) {
                    var line = lines[j];
                    line.plus_point = 0;
                }
                for (var j = 0; j < lines.length; j++) {
                    var line = lines[j];
                    if (line['redeem_point'] || line['promotion'] || line['redeem_point'] != 0) {
                        line['plus_point'] = 0;
                        continue;
                    } else {
                        line.plus_point = 0;
                        for (var i = 0; i < rules.length; i++) {
                            var rule = rules[i];
                            var line_plus_point = line.get_price_with_tax() * rule['coefficient'];
                            if ((rule['type'] == 'products' && rule['product_ids'].indexOf(line.product['id']) != -1) || (rule['type'] == 'categories' && rule['category_ids'].indexOf(line.product.pos_categ_id[0]) != -1) || (rule['type'] == 'order_amount')) {
                                var plus_point = round_pr(line_plus_point, this.pos.loyalty.rounding);
                                if (line.is_return) {
                                    plus_point = - plus_point
                                }
                                line.plus_point += plus_point;
                                total_point += plus_point;
                            }
                        }
                    }
                }
            }
            return total_point;
        },
        build_redeem_point: function () {
            var redeem_point = 0;
            var lines = this.orderlines.models;
            if (lines.length == 0 || !lines) {
                return redeem_point;
            }
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                var line_redeem_point = line['redeem_point'];
                if (line_redeem_point) {
                    redeem_point += line_redeem_point;
                }
                if (line.credit_point) {
                    line['redeem_point'] = line.credit_point;
                    redeem_point += line.redeem_point;
                    line.credit_point = 0;
                }
            }
            return round_pr(redeem_point || 0, this.pos.loyalty.rounding);
        },
        get_client_point: function () {
            var client = this.get_client();
            if (!client) {
                return {
                    redeem_point: 0,
                    plus_point: 0,
                    pos_loyalty_point: 0,
                    remaining_point: 0,
                    next_point: 0,
                    client_point: 0
                }
            }
            var redeem_point = this.build_redeem_point();
            var redeem_point_rounded = round_pr(redeem_point, this.pos.loyalty.rounding);
            var plus_point = this.build_plus_point();
            var plus_point_rounded = round_pr(plus_point, this.pos.loyalty.rounding);
            var pos_loyalty_point = client.pos_loyalty_point || 0;
            var remaining_point = pos_loyalty_point - redeem_point;
            var remaining_point_rounded = round_pr(remaining_point, this.pos.loyalty.rounding);
            var next_point = pos_loyalty_point - redeem_point + plus_point;
            var next_point_rounded = round_pr(next_point, this.pos.loyalty.rounding);
            return {
                redeem_point: redeem_point_rounded,
                plus_point: plus_point_rounded,
                pos_loyalty_point: pos_loyalty_point,
                remaining_point: remaining_point_rounded,
                next_point: next_point_rounded,
                client_point: pos_loyalty_point,
            }
        }
    });

    var _super_Orderline = models.Orderline.prototype;
    models.Orderline = models.Orderline.extend({
        initialize: function (attributes, options) {
            var res = _super_Orderline.initialize.apply(this, arguments);
            this.plus_point = this.plus_point || 0;
            this.redeem_point = this.redeem_point || 0;
            return res;
        },
        init_from_JSON: function (json) {
            var res = _super_Orderline.init_from_JSON.apply(this, arguments);
            if (json.plus_point) {
                this.plus_point = json.plus_point;
            }
            if (json.redeem_point) {
                this.redeem_point = json.redeem_point;
            }
            if (json.reward_id) {
                this.reward_id = json.reward_id;
            }
            return res;
        },
        export_as_JSON: function () {
            var json = _super_Orderline.export_as_JSON.apply(this, arguments);
            if (this.plus_point) {
                json.plus_point = this.plus_point;
            }
            if (this.redeem_point) {
                json.redeem_point = this.redeem_point;
            }
            if (this.reward_id) {
                json.reward_id = json.reward_id;
            }
            return json;
        }
    });
    screens.OrderWidget.include({
        active_loyalty: function (buttons, selected_order) {
            if (selected_order && selected_order.is_return) {
                return buttons.reward_button.highlight(false);
            }
            var $loyalty_element = $(this.el).find('.summary .loyalty');
            var lines = selected_order.orderlines.models;
            if (!lines || lines.length == 0) {
                $loyalty_element.addClass('oe_hidden');
                if (buttons && buttons.reward_button) {
                    buttons.reward_button.highlight(false);
                }
            } else {
                var client = selected_order.get_client();
                var $plus_point = this.el.querySelector('.plus_point');
                var $redeem_point = this.el.querySelector('.redeem_point');
                var $remaining_point = this.el.querySelector('.remaining_point');
                var $client_point = this.el.querySelector('.client_point');
                var $next_point = this.el.querySelector('.next_point');
                if (client) {
                    var points = selected_order.get_client_point();
                    if ($plus_point) {
                        $plus_point.textContent = points['plus_point'];
                    }
                    if ($redeem_point) {
                        $redeem_point.textContent = points['redeem_point'];
                    }
                    if ($client_point) {
                        $client_point.textContent = points['client_point'];
                    }
                    if ($remaining_point) {
                        $remaining_point.textContent = points['remaining_point'];
                    }
                    if ($next_point) {
                        $next_point.textContent = points['next_point'];
                    }
                    selected_order.plus_point = points['plus_point'];
                    selected_order.redeem_point = points['redeem_point'];
                    selected_order.remaining_point = points['remaining_point'];
                    if (client['pos_loyalty_point'] > points['redeem_point'] && buttons && buttons.reward_button) {
                        buttons.reward_button.highlight(true);
                    }
                    else if (client['pos_loyalty_point'] <= points['redeem_point'] && buttons && buttons.reward_button) {
                        buttons.reward_button.highlight(false);
                    }
                }
            }
        },
        update_summary: function () {
            this._super();
            var buttons = this.getParent().action_buttons;
            var order = this.pos.get_order();
            if (order && buttons && this.pos.loyalty) {
                this.active_loyalty(buttons, order);
            }
        }
    })
});
