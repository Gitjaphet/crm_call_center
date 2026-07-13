from odoo import models, fields, api
from datetime import date, datetime, timedelta

class CrmLead(models.Model):
    _inherit = 'crm.lead'

    nb_tentatives = fields.Integer(string='Nombre de tentatives', default=0)
    date_premier_appel = fields.Date(string='Date premier appel')
    jour_relance = fields.Integer(string='Jour de relance', default=1)
    heure_relance = fields.Selection([
        ('matin', 'Matin'),
        ('apresmidi', 'Après-midi'),
    ], string='Plage horaire', default='matin')
    statut_appel = fields.Selection([
        ('nouveau', 'Nouveau'),
        ('en_cours', 'En cours'),
        ('repondeur', 'Répondeur'),
        ('rappel', 'Rappel'),
        ('rappel_programme', 'Rappel programmé'),
        ('rdv', 'RDV'),
        ('termine', 'Terminé'),
    ], string='Statut appel', default='nouveau')
    
    priorite_appel = fields.Integer(string='Priorité', compute='_compute_priorite', store=True)
    date_dernier_appel = fields.Datetime(string='Date/heure dernier appel')
    duree_dernier_appel = fields.Integer(string='Durée dernier appel (s)', default=0)
    heure_debut_appel = fields.Char(string='Heure début appel')
    date_prochaine_relance = fields.Datetime(string='Date prochaine relance')

    @api.depends('jour_relance', 'nb_tentatives', 'date_premier_appel')
    def _compute_priorite(self):
        for lead in self:
            if lead.jour_relance == 3: lead.priorite_appel = 1
            elif lead.jour_relance == 2: lead.priorite_appel = 2
            elif lead.jour_relance == 1: lead.priorite_appel = 3
            else: lead.priorite_appel = 5

    def action_appel_repondu(self):
        self.write({'statut_appel': 'en_cours'})

    def action_pas_de_reponse(self):
        for lead in self:
            nb = (lead.nb_tentatives or 0) + 1
            vals = {'nb_tentatives': nb, 'statut_appel': 'repondeur'}
            if not lead.date_premier_appel:
                vals['date_premier_appel'] = date.today()
            
            if nb >= 6:
                vals['statut_appel'] = 'termine'
            else:
                if lead.heure_relance == 'matin':
                    vals['heure_relance'] = 'apresmidi'
                    vals['date_prochaine_relance'] = False
                else:
                    vals['heure_relance'] = 'matin'
                    vals['jour_relance'] = (lead.jour_relance or 1) + 1
                    if (lead.jour_relance or 1) > 3:
                        vals['statut_appel'] = 'termine'
                    else:
                        target = datetime.now().replace(hour=7, minute=0, second=0, microsecond=0) + timedelta(days=1)
                        vals['date_prochaine_relance'] = target
            lead.write(vals)

    def action_cron_relances(self):
        now = fields.Datetime.now()
        leads = self.search([
            ('statut_appel', '=', 'repondeur'),
            ('date_prochaine_relance', '<=', now),
            ('active', '=', True)
        ])
        leads.write({'statut_appel': 'nouveau', 'date_prochaine_relance': False})
