# -*- coding: utf-8 -*-
from odoo import api, fields, models, tools, _

class res_partner_credit(models.Model):
    _name = "res.partner.group"
    _description = "Customers group"

    name = fields.Char('Name', required=1)