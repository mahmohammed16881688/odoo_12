# -*- coding: utf-8 -*-
from odoo import api, fields, models, _


class product_variant(models.Model):
    _name = "product.variant"
    _rec_name = "product_tmpl_id"
    _description = "Management sale product variant"

    product_tmpl_id = fields.Many2one('product.template', 'Combo', required=1,
                                      domain=[('available_in_pos', '=', True)])
    attribute_id = fields.Many2one('product.attribute', 'Attribute', required=1)
    value_id = fields.Many2one('product.attribute.value', string='Value', required=1)
    price_extra = fields.Float('Price extra', help='Price extra will included to public price of product', required=1)

    product_id = fields.Many2one('product.product', 'Product link stock',
                                 help='If choose, will made stock move, automatic compute on hand of this product')
    uom_id = fields.Many2one('uom.uom', 'Unit link stock') # v12 only
    quantity = fields.Float('Quantity', help='Quantity link stock')
    active = fields.Boolean('Active', default=1)

class product_attribute(models.Model):
    _inherit = 'product.attribute'

    multi_choice = fields.Boolean('Multi choose')
