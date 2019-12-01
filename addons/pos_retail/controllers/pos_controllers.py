# -*- coding: utf-8 -*
from odoo.http import request
from odoo.addons.bus.controllers.main import BusController
from odoo.addons.web.controllers.main import DataSet
from odoo import api, http, SUPERUSER_ID
from odoo.addons.web.controllers.main import ensure_db, Home, Session, WebClient
from odoo.addons.point_of_sale.controllers.main import PosController
import json
import ast
import werkzeug.utils

import logging

_logger = logging.getLogger(__name__)


class pos_controller(PosController):

    @http.route('/pos/web', type='http', auth='user')
    def pos_web(self, debug=False, **k):
        session_info = request.env['ir.http'].session_info()
        server_version_info = session_info['server_version_info'][0]
        pos_sessions = None
        if server_version_info == 10:
            pos_sessions = request.env['pos.session'].search([
                ('state', '=', 'opened'),
                ('user_id', '=', request.session.uid),
                ('name', 'not like', '(RESCUE FOR')])
        if server_version_info in [11, 12]:
            pos_sessions = request.env['pos.session'].search([
                ('state', '=', 'opened'),
                ('user_id', '=', request.session.uid),
                ('rescue', '=', False)])
        if not pos_sessions:  # auto directly login odoo to pos
            if request.env.user.pos_config_id:
                request.env.user.pos_config_id.current_session_id = request.env['pos.session'].sudo().create({
                    'user_id': request.env.user.id,
                    'config_id': request.env.user.pos_config_id.id,
                })
                pos_sessions = request.env.user.pos_config_id.current_session_id
                pos_sessions.action_pos_session_open()
        if not pos_sessions:
            return werkzeug.utils.redirect('/web#action=point_of_sale.action_client_pos_menu')
        pos_session = pos_sessions[0]
        pos_session.login()
        if pos_session:
            config = pos_session.config_id
            session_info['big_datas'] = config.big_datas
            # add big_datas for pos frontend
            # call function load_server_data of not
        session_info['model_ids'] = {
            'product.product': {},
            'res.partner': {},
            'account.invoice': {},
            'account.invoice.line': {},
            'pos.order': {},
            'pos.order.line': {},
            'sale.order': {},
            'sale.order.line': {},
        }
        session_info['currency_id'] = request.env.user.company_id.currency_id.id
        model_list = {
            'product.product': 'product_product',
            'res.partner': 'res_partner',
            'account.invoice': 'account_invoice',
            'account.invoice.line': 'account_invoice_line',
            'pos.order': 'pos_order',
            'pos.order.line': 'pos_order_line',
            'sale.order': 'sale_order',
            'sale.order.line': 'sale_order_line',
        }
        if session_info['big_datas']:
            for object, table in model_list.items():
                request.env.cr.execute("select min(id) from %s" % table)
                min_ids = request.env.cr.fetchall()
                session_info['model_ids'][object]['min_id'] = min_ids[0][0] if min_ids and min_ids[0] else 1
                request.env.cr.execute("select max(id) from %s" % table)
                max_ids = request.env.cr.fetchall()
                session_info['model_ids'][object]['max_id'] = max_ids[0][0] if max_ids and max_ids[0] else 1
        context = {
            'session_info': json.dumps(session_info)
        }
        return request.render('point_of_sale.index', qcontext=context)


class web_login(Home):  # auto go directly POS when login
    @http.route()
    def web_login(self, *args, **kw):
        ensure_db()
        response = super(web_login, self).web_login(*args, **kw)
        if request.session.uid:
            user = request.env['res.users'].browse(request.session.uid)
            pos_config = user.pos_config_id
            if pos_config:
                return http.local_redirect('/pos/web/')
        return response


class pos_bus(BusController):

    def _poll(self, dbname, channels, last, options):
        channels = list(channels)
        if request.env.user:
            channels.append((request.db, 'pos.sync.pricelists', request.env.user.id))
            channels.append((request.db, 'pos.sync.promotions', request.env.user.id))
            channels.append((request.db, 'pos.remote_sessions', request.env.user.id))
            channels.append((request.db, 'pos.sync.sessions', request.env.user.id))
            channels.append((request.db, 'pos.sync.backend', request.env.user.id))
            channels.append((request.db, 'pos.sync.stock', request.env.user.id))
        return super(pos_bus, self)._poll(dbname, channels, last, options)

    @http.route('/pos/update_order/status', type="json", auth="public")
    def bus_update_sale_order(self, status, order_name):
        sales = request.env["sale.order"].sudo().search([('name', '=', order_name)])
        sales.write({'sync_status': status})
        return 1

    @http.route('/pos/sync', type="json", auth="public")
    def send(self, bus_id, messages):
        for message in messages:
            if not message.get('value', None) \
                    or not message['value'].get('order_uid', None) \
                    or not message['value'].get('action', None):
                continue
            user_send_id = message['user_send_id']
            sessions = request.env['pos.session'].sudo().search([
                ('state', '=', 'opened'),
                ('user_id', '!=', user_send_id),
                ('config_id.bus_id', '=', bus_id),
            ])
            request.env['pos.bus.log'].sudo().create({
                'user_id': user_send_id,
                'bus_id': bus_id,
                'action': message['value'].get('action')
            })
            if not sessions:
                return True
            for session in sessions:
                request.env['bus.bus'].sendmany(
                    [[(request.env.cr.dbname, 'pos.sync.sessions', session.user_id.id), message]])
        return True
