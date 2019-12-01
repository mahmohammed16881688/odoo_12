"use strict";
odoo.define('pos_retail.create_lots', function (require) {
    var gui = require('point_of_sale.gui');
    var PopupWidget = require('point_of_sale.popups');
    var screens = require('point_of_sale.screens');
    var rpc = require('pos.rpc');

    var popup_create_lots = PopupWidget.extend({
        template: 'popup_create_lots',
        events: _.extend({}, PopupWidget.prototype.events, {
            'click .lot-add': 'add_new_lot',
            'click .lot-delete': 'delete_lot'
        }),
        init_quickly_search_products: function (options) {
            var $input_lot = $('input[name=product_id]');
            $input_lot.autocomplete({
                source: this.products_search,
                minLength: this.pos.config.min_length_search,
            });
        },
        show: function (options) {
            if (options && options.selected_orderline) {
                options.lot_ids = options.selected_orderline.lot_ids;
            } else {
                options.lot_ids = [];
            }
            this.options = options;
            this.lots_cache = options.lots_cache;
            this._super(options);
            var products = this.pos.db.get_product_by_category(0);
            var products_search = [];
            for (var i = 0; i < products.length; i++) {
                var product = products[i];
                if (product.tracking != 'none' && this.pos.db.product_id_by_name[product['display_name']]) {
                    products_search.push({
                        value: product['display_name'],
                        label: product['display_name']
                    })
                }
            }
            this.products_search = products_search;
            this.init_quickly_search_products(this.options);
        },
        click_confirm: function () {
            var fields = {};
            var self = this;
            $('.lot_input').each(function (idx, el) {
                if (!fields[el.id]) {
                    fields[el.id] = {};
                }
                if (el.name == 'name') {
                    fields[el.id]['name'] = el.value || ''
                }
                if (el.name == 'product_id') {
                    var product_id = self.pos.db.product_id_by_name[el.value];
                    if (product_id) {
                        fields[el.id]['product_id'] = product_id
                    } else {
                        self.pos.gui.close_popup();
                        return self.pos.gui.show_popup('confirm', {
                            title: 'Warning',
                            body: 'Could not find product id of product name: ' + el.value
                        })
                    }
                }
                if (el.name == 'quantity') {
                    fields[el.id]['quantity'] = parseFloat(el.value) || 0
                }
            });
            this.pos.gui.close_popup();
            var lots = [];
            for (var index in fields) {
                lots.push(fields[index])
            }
            if (this.options.confirm) {
                this.options.confirm.call(this, lots);
            }
        },
        add_new_lot: function (e) {
            var table = document.getElementById('lots_tree');
            var rowCount = table.getElementsByTagName("tbody")[0].getElementsByTagName("tr").length;

            var newRow = table.insertRow(rowCount);
            var row = rowCount - 1;
            newRow.id = row;

            var col0html = "<input class='lot_input'" + " name='name'" + " type='text'" + "id='" + row + "'" + ">" + "</input>";
            var col1html = "<input class='lot_input'" + " name='product_id'" + " type='text'" + "id='" + row + "'" + ">" + "</input>";
            var col2html = "<input class='lot_input'" + " name='quantity'" + " type='text'" + "id='" + row + "'" + ">" + "</input>";
            var col3html = "<span class='lot-delete fa fa-trash-o' name='delete'/>";

            var col0 = newRow.insertCell(0);
            col0.innerHTML = col0html;
            var col1 = newRow.insertCell(1);
            col1.innerHTML = col1html;
            var col2 = newRow.insertCell(2);
            col2.innerHTML = col2html;
            var col3 = newRow.insertCell(3);
            col3.innerHTML = col3html;
            this.init_quickly_search_products(this.options);

        },
        delete_lot: function (e) {
            var tr = $(e.currentTarget).closest('tr');
            var record_id = tr.find('td:first-child').text();
            if (parseInt(record_id))
                tr.find("td:not(:first)").remove();
            else
                tr.find("td").remove();
            tr.hide();
            this.init_quickly_search_products(this.options);
        }
    });
    gui.define_popup({name: 'popup_create_lots', widget: popup_create_lots});

    var button_create_lots = screens.ActionButtonWidget.extend({
        template: 'button_create_lots',
        init: function (parent, options) {
            this._super(parent, options);
        },
        button_click: function () {
            var self = this;
            this.gui.show_popup('popup_create_lots', {
                title: 'Create lots',
                lots_cache: this.pos.lots_cache || [],
                confirm: function (lots) {
                    if (!lots.length) {
                        return;
                    }
                    this.pos.lots_cache = lots;
                    for (var i = 0; i < lots.length; i++) {
                        var lot = lots[i];
                        if (!lot['name']) {
                            self.pos.lots_cache = [];
                            return self.pos.gui.show_popup('confirm', {
                                title: 'Warning',
                                body: 'Serial/number could not blank'
                            })
                        }
                        if (!lot['product_id']) {
                            self.pos.lots_cache = [];
                            return self.pos.gui.show_popup('confirm', {
                                title: 'Warning',
                                body: 'Product not found'
                            })
                        }
                    }
                    var lot_model = self.pos.get_model('stock.production.lot');
                    var location = self.pos.get_location();
                    if (!location) {
                        return self.posmodel.gui.show_popup('dialog', {
                            title: 'Warning',
                            body: 'POS stock location not found',
                        })
                    }
                    return rpc.query({
                        model: 'stock.production.lot',
                        method: 'pos_create_lots',
                        args: [[], lots, lot_model.fields, self.pos.shop.name,location.id],
                        context: {}
                    }).then(function (lots_value) {
                        var lot_model = self.pos.get_model('stock.production.lot');
                        lot_model.loaded(self.pos, lots_value, {});
                        self.pos.lots_cache = [];
                        return self.pos.gui.show_popup('dialog', {
                            title: 'Great job',
                            body: 'Your lots have added to backend and pos. You can use it now',
                            color: 'success'
                        })
                    }).fail(function (type, error) {
                        return self.pos.query_backend_fail(type, error);
                    });
                }
            })
        }
    });
    screens.define_action_button({
        'name': 'button_create_lots',
        'widget': button_create_lots,
        'condition': function () {
            return this.pos.config.create_lots;
        }
    });
});
