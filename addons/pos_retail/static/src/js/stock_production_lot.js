"use strict";
/*
    This module create by: thanhchatvn@gmail.com
    License: OPL-1
    Please do not modification if i not accept
    Thanks for understand
 */
odoo.define('pos_retail.pack_lot', function (require) {
    var models = require('point_of_sale.models');

    var _super_packlot_line = models.Packlotline.prototype;
    models.Packlotline = models.Packlotline.extend({
        set_lot_name: function (name, lot) {
            if (name && self.posmodel && self.posmodel.config.checking_lot) {
                lot = self.posmodel.lot_by_name[name];
                if (!lot) {
                    return self.posmodel.gui.show_popup('confirm', {
                        title: 'Warning',
                        body: 'Your pos config active checking lot is true, and Lot name just input wrong, please checking and try again'
                    })
                }
            }
            var res = _super_packlot_line.set_lot_name.apply(this, arguments);
            if (lot) {
                this.set({lot : lot});
            } else {
                lot = self.posmodel.lot_by_name[name];
                if (lot) {
                    this.set({lot : lot});
                }
            }
            if (lot) {
                self.posmodel.gui.show_popup('dialog', {
                    title: 'Great job',
                    body: 'You added lot ' + name + ' to product ' + this.order_line.product.display_name + ' succeed !',
                    color: 'success'
                })
                if (this.order_line) {
                    this.order_line.trigger('change', this.order_line);
                }
            }
            return res;
        },
        export_as_JSON: function () {
            var json = _super_packlot_line.export_as_JSON.apply(this, arguments);
            if (this.lot) {
                json['lot_id'] = this.lot.id
            }
            return json
        },
        init_from_JSON: function (json) {
            var res = _super_packlot_line.init_from_JSON.apply(this, arguments);
            if (json.lot_id) {
                var lot = this.pos.lot_by_id[json.lot_id];
                if (lot) {
                    this.set_lot(lot)
                }
            }
            return res;
        },
    })
});
