<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:F5A65B,100:E85D8A&height=160&section=header&text=Budgy&fontSize=40&fontColor=fff&animation=twinkling&fontAlignY=35&desc=SaaS%20multi-tenant%20de%20gestion%20des%20dépenses&descAlignY=58&descSize=16" width="100%"/>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/Status-Production-success?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Multi--tenant-django--tenants-blue?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Madagascar-🇲🇬-red?style=for-the-badge" />
</p>

![Odoo](https://img.shields.io/badge/Odoo_19-714B67?style=flat-square&logo=odoo&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?style=flat-square&logo=postgresql&logoColor=white)
![OWL](https://img.shields.io/badge/OWL_Framework-714B67?style=flat-square)
![Cron](https://img.shields.io/badge/Scheduled_Jobs-Cron-555555?style=flat-square)

## À propos

Un module Odoo développé sur mesure pour une équipe de setting commercial B2B recevant des leads à traiter quotidiennement. Le CRM standard devient un véritable outil de centre d'appels : file d'appel priorisée, relances automatiques sur plusieurs jours, et widget d'appel intégré directement dans l'interface.

## Fonctionnalités

- 📞 **File d'appel intelligente** triée par priorité selon le jour de relance, avec exclusion automatique des dossiers déjà traités
- 🔁 **Moteur de relance automatique** : bascule matin/après-midi puis reprogrammation du lendemain, jusqu'à 6 tentatives avant clôture
- ⏰ **Tâche planifiée (cron)** qui réactive les leads en attente dès l'heure de relance atteinte, sans intervention manuelle
- 🖱️ **Widget d'appel custom (OWL)** avec qualification en un clic : répondeur, rappel, rappel programmé, RDV, hors cible, faux numéro

## Stack technique

| Couche | Technologie |
|---|---|
| ERP | Odoo 19 |
| Backend | Python |
| Frontend | OWL (Odoo Web Library) |
| Base de données | PostgreSQL |
| Automatisation | Cron Jobs (Odoo Scheduled Actions) |

## Démo

▶️ [Voir la démo vidéo](https://youtu.be/QJah_xOpSFQ)
