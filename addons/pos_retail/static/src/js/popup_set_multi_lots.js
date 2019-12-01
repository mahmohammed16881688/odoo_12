"use strict";
odoo.define('pos_retail.multi_lots', function (require) {
    var gui = require('point_of_sale.gui');
    var PopupWidget = require('point_of_sale.popups');

    var popup_set_multi_lots = PopupWidget.extend({
        template: 'popup_set_multi_lots',
        events: _.extend({}, PopupWidget.prototype.events, {
            'click .lot-add': 'add_new_lot',
            'click .lot-delete': 'delete_lot'
        }),
        init_quickly_search_lots: function (options) {
            var lots = this.pos.lot_by_product_id[options.selected_orderline.product.id];
            if (lots) {
                var lots_auto_complete = [];
                for (var i = 0; i < lots.length; i++) {
                    lots_auto_complete.push({
                        value: lots[i]['name'],
                        label: lots[i]['name']
                    })
                }
                var $input_lot = $('input[name=lot_name]');
                $input_lot.autocomplete({
                    source: lots_auto_complete,
                    minLength: 0,
                });
            }
        },
        show: function (options) {
            if (options && options.selected_orderline) {
                options.lot_ids = options.selected_orderline.lot_ids;
            } else {
                options.lot_ids = [];
            }
            this.options = options;
            this._super(options);
            this.init_quickly_search_lots(this.options);
        },
        click_confirm: function () {
            var fields = {};
            $('.lot_input').each(function (idx, el) {
                if (!fields[el.id]) {
                    fields[el.id] = {};
                }
                if (el.name == 'lot_name') {
                    fields[el.id]['name'] = el.value || ''
                }
                if (el.name == 'lot_quantity'){
                    fields[el.id]['quantity'] = el.value || 0
                }
            });
            this.pos.gui.close_popup();
            if (this.options.confirm) {
                var lots = [];
                for (var index in fields) {
                    lots.push(fields[index])
                }
                this.options.confirm.call(this, lots);
            }
        },
        add_new_lot: function (e) {
            var table = document.getElementById('lots_list');
            var rowCount = table.getElementsByTagName("tbody")[0].getElementsByTagName("tr").length;

            var newRow = table.insertRow(rowCount);
            var row = rowCount - 1;
            newRow.id = row;

            var col0html = "<input class='lot_input'" + " name='lot_name'" + " type='text'" + "id='" + row + "'" + ">" + "</input>";
            var col1html = "<input class='lot_input'" + " name='lot_quantity'" + " type='text'" + "id='" + row + "'" + ">" + "</input>";
            var col2html = "<span class='lot-delete fa fa-trash-o' name='delete'/>";

            var col0 = newRow.insertCell(0);
            col0.innerHTML = col0html;
            var col1 = newRow.insertCell(1);
            col1.innerHTML = col1html;
            var col2 = newRow.insertCell(2);
            col2.innerHTML = col2html;
            this.init_quickly_search_lots(this.options);

        },
        delete_lot: function (e) {
            var tr = $(e.currentTarget).closest('tr');
            var record_id = tr.find('td:first-child').text();
            if (parseInt(record_id))
                tr.find("td:not(:first)").remove();
            else
                tr.find("td").remove();
            tr.hide();
            this.init_quickly_search_lots(this.options);
        }
    });
    gui.define_popup({name: 'popup_set_multi_lots', widget: popup_set_multi_lots});
});
