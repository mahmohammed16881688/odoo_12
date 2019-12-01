# -*- coding: utf-8 -*-
from odoo import api, fields, models, tools, _, registry

class pos_order_line(models.Model):
    _inherit = "pos.order.line"

    uom_id = fields.Many2one('uom.uom', 'Uom', readonly=1)