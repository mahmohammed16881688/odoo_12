# -*- coding: utf-8 -*-
from odoo import fields, models, api, _
import json
from odoo.exceptions import UserError

import logging

_logger = logging.getLogger(__name__)


class pos_remote_session(models.TransientModel):
    _name = "pos.remote.session"
    _description = "Help manage remote sessions"

    open_session = fields.Boolean('Open Session')
    validate_and_post_entries = fields.Boolean('Validate and Post entries')
    close_session = fields.Boolean('Close session')
    lock_session = fields.Boolean('Lock session')
    unlock_session = fields.Boolean('Unlock session')
    remove_cache = fields.Boolean('Remove cache')
    message = fields.Text('Message')
    config_ids = fields.Many2many('pos.config', 'remote_session_config_rel', 'wiz_id', 'config_id',
                                  'POS config need to do', required=1)

    @api.multi
    def send_notifications(self):
        for record in self:
            if not record.config_ids:
                raise UserError(_('Warning, please add pos config the first'))
            for config in record.config_ids:
                vals = {
                    'close_session': record.close_session,
                    'validate_and_post_entries': record.validate_and_post_entries,
                    'lock_session': record.lock_session,
                    'unlock_session': record.unlock_session,
                    'message': record.message,
                    'open_session': record.open_session,
                    'config_id': config.id,
                    'remove_cache': record.remove_cache,
                    'session_id': None,
                }
                sessions = self.env['pos.session'].search([('config_id', '=', config.id), ('state', '=', 'opened')])
                if sessions:
                    vals.update({'session_id': sessions[0].id})
                    user = sessions[0].user_id
                    self.env['bus.bus'].sendmany(
                        [[(self.env.cr.dbname, 'pos.remote_sessions', user.id), json.dumps(vals)]])
                else:
                    users = self.env['res.users'].search([('pos_config_id', '=', config.id)])
                    for user in users:
                        self.env['bus.bus'].sendmany(
                            [[(self.env.cr.dbname, 'pos.remote_sessions', user.id), json.dumps(vals)]])
        return True


    @api.onchange('open_session')
    def on_change_open_session(self):
        if self.open_session:
            self.close_session = False


    @api.onchange('close_session')
    def on_change_close_session(self):
        if self.close_session:
            self.open_session = False

    @api.onchange('validate_and_post_entries')
    def on_change_validate_and_post_entries(self):
        if self.validate_and_post_entries:
            self.open_session = False
            self.unlock_session = False
            self.lock_session = False


    @api.onchange('lock_session')
    def on_change_lock_session(self):
        if self.lock_session:
            self.unlock_session = False

    @api.onchange('unlock_session')
    def on_change_unlock_session(self):
        if self.unlock_session:
            self.lock_session = False