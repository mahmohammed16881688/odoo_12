# -*- coding: utf-8 -*-
from odoo import fields, api, models

import logging
import base64
import json

_logger = logging.getLogger(__name__)


class stock_location(models.Model):
    _inherit = "stock.location"

    available_in_pos = fields.Boolean('Available in pos')

    @api.multi
    def pos_update_stock_on_hand_by_location_id(self, vals={}):
        wizard = self.env['stock.change.product.qty'].create(vals)
        wizard.change_product_qty()
        location = self.browse(vals.get('location_id'))
        product = self.env['product.product'].with_context({'location': location.id}).browse(vals.get('product_id'))
        return {
            'location': location.name,
            'product': product.display_name,
            'quantity': product.qty_available
        }
