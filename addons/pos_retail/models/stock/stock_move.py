# -*- coding: utf-8 -*-
from odoo import fields, api, models
import json

import logging
_logger = logging.getLogger(__name__)

class stock_move(models.Model):

    _inherit = "stock.move"

    @api.model
    def create(self, vals):
        """
            if move create from pos order line
            and pol have uom ID and pol uom ID difference with current move
            we'll re-update product_uom of move
            FOR linked stock on hand of product
        """
        move = super(stock_move, self).create(vals)
        order_lines = self.env['pos.order.line'].search([
            ('name', '=', move.name),
            ('product_id', '=', move.product_id.id),
            ('qty', '=', move.product_uom_qty)
        ])
        for line in order_lines:
            if line.uom_id and line.uom_id != move.product_uom:
                move.write({
                    'product_uom': line.uom_id.id
                })
        return move

    @api.multi
    def write(self, vals):
        parent = super(stock_move, self).write(vals)
        for move in self:
            if vals.get('state', False) == 'done' and move.product_id.type == 'product':
                self.sync_stock_to_pos_sessions(move.product_id.id)
        return parent

    @api.model
    def sync_stock_to_pos_sessions(self, product_id):
        sessions = self.env['pos.session'].sudo().search([
            ('state', '=', 'opened')
        ])
        for session in sessions:
            self.env['bus.bus'].sendmany(
                [[(self.env.cr.dbname, 'pos.sync.stock', session.user_id.id), json.dumps([product_id])]])
        return True

    @api.model
    def get_stock_datas(self, location_id, product_need_update_onhand=[]):
        _logger.info('begin get_stock_datas()')
        _logger.info(location_id)
        _logger.info(product_need_update_onhand)
        values = {}
        product_object = self.env['product.product'].sudo()
        if not product_need_update_onhand:
            datas = product_object.with_context({'location': location_id}).search_read(
                [('type', '=', 'product'), ('available_in_pos', '=', True)], ['qty_available'])
        else:
            datas = product_object.with_context({'location': location_id}).search_read(
                [('id', 'in', product_need_update_onhand)],
                ['name', 'qty_available', 'default_code'])
        for data in datas:
            values[data['id']] = data['qty_available']
        return values

