# 01 — PRD · Plateforme de mini-séries en streaming (nom de travail : **Gaatshort**)

| | |
|---|---|
| Version | 0.2 — **brouillon soumis à validation** |
| Date | 2026-10-19 |
| Statut | Phase 1 (spécification). Aucune ligne de code applicatif n'est autorisée avant validation des 6 documents. |

**Historique**
- 0.1 (2026-10-19) — première version.
- 0.2 (2026-10-19) — intègre les réponses Q-01, Q-03, Q-04, Q-05, Q-06, Q-07 : modèle par crédits confirmé ; PayTech devient le canal d'encaissement principal ; catalogue de **100 séries** ; stratégie stores documentée (TRD §16) ; Gambie sans compte Wave ; règle de licence et « marque maison ».
| Documents liés | [02-TRD](02-TRD.md) · [03-APPFLOW](03-APPFLOW.md) · [04-UI-UX-Design](04-UI-UX-Design.md) · [05-BACKEND-SCHEMA](05-BACKEND-SCHEMA.md) · [06-IMPLEMENTATION-PLAN](06-IMPLEMENTATION-PLAN.md) |

> **Convention de statut des décisions**
> - **[VALIDÉ]** : décidé par le porteur du projet (réponses du 2026-10-19).
> - **[PROPOSÉ]** : recommandation de l'équipe technique, à valider.
> - **[À CONFIRMER]** : dépend d'une information externe (fournisseur, juriste, comptable, contrat de licence).

---

## 1. Vision et objectifs

**Vision.** Offrir au public du Sénégal et de la Gambie des mini-séries dramatiques au format court (épisodes de 1 à 3 minutes, vidéo verticale), regardables sur mobile même avec une connexion modeste, payables en mobile money, et distribuées sous **plusieurs marques en marque blanche** opérées par des tiers sur une seule plateforme technique.

**Objectifs à 6 mois après lancement** (cibles proposées, à valider — voir §15) :

| # | Objectif | Indicateur |
|---|---|---|
| O1 | Prouver l'appétit pour le format | ≥ 40 % des visiteurs qui lancent un épisode regardent ≥ 3 épisodes |
| O2 | Prouver la conversion payante | ≥ 3 % des utilisateurs actifs mensuels achètent au moins un pack de crédits |
| O3 | Prouver le modèle marque blanche | ≥ 2 marques tierces en production sur la même plateforme |
| O4 | Fiabilité des paiements | 0 crédit attribué sans paiement vérifié côté serveur ; ≥ 99 % des paiements réussis crédités en < 60 s |

## 2. Problème utilisateur et proposition de valeur

| Problème | Proposition de valeur |
|---|---|
| Les plateformes de séries internationales sont payables par carte bancaire, en devises étrangères, et consomment beaucoup de données. | Paiement en **Wave, Orange Money, Free Money** ; prix en **XOF** et **GMD** ; lecture adaptative avec **mode économie de données**. |
| Le contenu court et addictif (format « drama vertical ») est peu disponible en français/anglais pour ce marché. | Catalogue sous licence, sous-titré **FR / EN**, découpé en épisodes courts avec cliffhangers. |
| Un éditeur/média local qui veut lancer sa propre plateforme doit tout construire. | **Marque blanche** : domaine, logo, couleurs, sélection du catalogue, prix et moyens de paiement propres, sur une infrastructure commune. |

## 3. Marchés cibles

| Pays | Devise | Langue principale de l'interface | Indicatif | Moyens de paiement visés | Statut |
|---|---|---|---|---|---|
| Sénégal | XOF (0 décimale) | Français | +221 | Wave, Orange Money, Free Money, carte | **[VALIDÉ]** pays de lancement |
| Gambie | GMD (2 décimales) à terme ; **XOF par carte au lancement** | Anglais | +220 | Carte bancaire via PayTech au lancement ; Wave Gambie plus tard | **[VALIDÉ]** pays de lancement — aucun compte Wave Business gambien à ce jour (Q-07), voir §11.3 |

Extension future : autres pays UEMOA (Côte d'Ivoire, Mali…) — l'architecture ne doit rien supposer de spécifique au Sénégal en dur (pays, devise, fuseau, moyens de paiement = configuration).

## 4. Personae et rôles

### 4.1 Personae finaux

| Persona | Description | Besoins clés |
|---|---|---|
| **Awa, 24 ans, Dakar** | Étudiante, Android d'entrée de gamme, forfait data limité, paie en Wave. | Démarrer vite, consommer peu de data, payer en 3 tapes avec Wave. |
| **Moussa, 38 ans, Thiès** | Fonctionnaire, Orange Money, regarde le soir. | Retrouver la série là où il s'est arrêté, payer en Orange Money. |
| **Fatou, 30 ans, Serrekunda (Gambie)** | Anglophone, Wave Gambie. | Interface et sous-titres en anglais, prix en dalasi. |

### 4.2 Rôles du système

| Rôle | Périmètre | Description |
|---|---|---|
| `VIEWER` | Tenant courant | Utilisateur final. |
| `PLATFORM_SUPER_ADMIN` | Plateforme (tous tenants) | Opérateur de la plateforme : tenants, catalogue global, licences, fournisseurs, finances consolidées. |
| `PLATFORM_CONTENT_MANAGER` | Plateforme | Gère le catalogue global (séries, épisodes, médias, sous-titres, licences). |
| `PLATFORM_FINANCE` | Plateforme | Consulte paiements, remboursements, rapprochements, reversements tous tenants. |
| `PLATFORM_SUPPORT` | Plateforme | Assistance utilisateurs, ajustement de crédits **audité**. |
| `TENANT_ADMIN` | Son tenant | Branding, domaines, sélection du catalogue, prix, moyens de paiement, utilisateurs back-office du tenant. |
| `TENANT_EDITOR` | Son tenant | Mise en avant (rails d'accueil), bannières, notifications. |
| `TENANT_FINANCE` | Son tenant | Commandes, paiements et rapports de revenus **de son seul tenant**. |
| `TENANT_SUPPORT` | Son tenant | Assistance aux utilisateurs de son tenant. |

## 5. Décisions métier structurantes

| ID | Sujet | Décision | Statut |
|---|---|---|---|
| D-01 | Modèle de tenant | Marques **en marque blanche pour des tiers** (le porteur n'est pas propriétaire des marques). | **[VALIDÉ]** |
| D-02 | Catalogue | **Partagé entre marques**. Le catalogue est détenu par la plateforme ; chaque tenant choisit les séries qu'il publie. | **[VALIDÉ]** |
| D-03 | Compte utilisateur | **Un seul compte** utilisateur pour toutes les marques (pas de compte par marque). | **[VALIDÉ]** |
| D-04 | Données rattachées à un compte | Identité **globale** ; portefeuille, achats, droits de visionnage, historique et favoris **propres à chaque marque** (un utilisateur qui a acheté chez la marque A ne débloque rien chez la marque B). Raison : chaque marque est une entreprise distincte qui encaisse ses propres revenus ; mutualiser les crédits entre marques rend la comptabilité et les reversements ingérables. | **[PROPOSÉ]** — question Q-02 |
| D-05 | Monétisation initiale | **Les 5 premiers épisodes de chaque série sont gratuits** (nombre configurable par série, défaut 5). | **[VALIDÉ]** |
| D-06 | Accès aux épisodes payants | **Portefeuille de crédits** : l'utilisateur achète un pack de crédits, puis chaque épisode payant est **débité directement de ses crédits** (débloqué à vie dans cette marque). Abonnement et publicité récompensée reportés après le MVP. | **[VALIDÉ]** (Q-01) |
| D-07 | Encaissement | La **plateforme est le marchand** : l'argent arrive **directement sur le compte PayTech de la plateforme**. Le taux de reversement aux marques n'est pas encore fixé : il est stocké comme paramètre par marque et les rapports affichent brut, frais et net. Les comptes marchands propres aux marques restent hors MVP. | **[VALIDÉ]** (Q-03) — taux **[À CONFIRMER]** |
| D-08 | Langues | Français et anglais (interface, métadonnées, sous-titres). | **[VALIDÉ]** |
| D-09 | Catalogue de lancement | **100 séries** sous licence au lancement (estimation de travail : ~60 épisodes par série, soit ~6 000 épisodes — Q-10). | **[VALIDÉ]** (Q-05) — volume d'épisodes **[À CONFIRMER]** |
| D-10 | Canaux | Site web (React rendu côté serveur, PWA installable) + application mobile React Native. | **[VALIDÉ]** |
| D-11 | Stratégie stores | **PWA d'abord** (achat en mobile money via PayTech) ; puis **application Android** sur Google Play, puis **iOS**, toutes deux avec **achats intégrés des stores** pour les packs et **portefeuille commun** avec le web. Détail : §11.4 et TRD §16. | **[PROPOSÉ]** — mise en place demandée par le porteur (Q-04) |
| D-12 | Gambie au lancement | Épisodes gratuits + achat de packs **par carte bancaire via PayTech, prix en XOF**, si PayTech accepte les cartes émises hors Sénégal (Q-11) ; à défaut, visionnage gratuit uniquement. Prix en GMD et Wave Gambie dès qu'un compte Wave Business gambien existe. | **[PROPOSÉ]** (suite Q-07) |
| D-13 | Licences et marques tierces | Aucune série n'est publiée sans **contrat de licence enregistré** (ayant droit, territoires, dates). Une série n'est proposée aux **marques tierces** que si le contrat autorise la **sous-licence**. La plateforme exploite sa propre **marque maison**, qui peut diffuser les séries licenciées sans droit de sous-licence. | **[PROPOSÉ]** (suite Q-06) |

## 6. Parcours et besoins métier

Les parcours détaillés (diagrammes, erreurs) sont dans [03-APPFLOW](03-APPFLOW.md).

| Parcours | Description | Flux |
|---|---|---|
| Découverte anonyme | Arrive sur la marque, voit l'accueil, ouvre une série, regarde les épisodes gratuits **sans compte**. | FLOW-02, FLOW-04, FLOW-05 |
| Conversion | Atteint le premier épisode payant → connexion par OTP → achat d'un pack → déblocage → lecture. | FLOW-01, FLOW-07, FLOW-08 |
| Fidélisation | Revient, « Continuer à regarder », favoris, notification de nouvel épisode. | FLOW-06, FLOW-11 |
| Exploitation contenu | Le gestionnaire de contenu crée une série, téléverse les épisodes, ajoute sous-titres, licence et dates, publie. | FLOW-13 |
| Exploitation marque | L'admin de la marque configure branding, domaine, catalogue publié, prix, moyens de paiement. | FLOW-14 |
| Exploitation plateforme | Le support assiste les utilisateurs ; la finance rapproche et rembourse. | FLOW-15, FLOW-16 |

## 7. Exigences fonctionnelles

Priorité : **M** = MVP obligatoire · **S** = MVP souhaitable (coupable si retard) · **L** = après MVP.

### 7.1 Authentification et compte (`FR-AUTH`)

| ID | Exigence | Prio |
|---|---|---|
| FR-AUTH-001 | Connexion/inscription **sans mot de passe** par OTP SMS sur numéro E.164 (+221, +220). | M |
| FR-AUTH-002 | Connexion par OTP e-mail en alternative. | S |
| FR-AUTH-003 | Session persistante (jeton d'accès court + jeton de rafraîchissement avec rotation), déconnexion, déconnexion de tous les appareils. | M |
| FR-AUTH-004 | Compte unique multi-marques : à la première connexion sur une marque, un **rattachement** (membership) à cette marque est créé après acceptation des CGU de la marque. | M |
| FR-AUTH-005 | Le visiteur peut regarder les épisodes gratuits sans compte ; la connexion est demandée au premier épisode payant ou à l'ajout en favori. | M |
| FR-AUTH-006 | Suppression du compte par l'utilisateur (droit à l'effacement), avec conservation des écritures financières anonymisées. | M |
| FR-AUTH-007 | Profil : nom affiché, langue, pays, préférence qualité vidéo. | M |

### 7.2 Catalogue et découverte (`FR-CAT`)

| ID | Exigence | Prio |
|---|---|---|
| FR-CAT-001 | Accueil composé de **rangées** (« À la une », « Nouveautés », « Populaires », « Continuer à regarder », rangées par genre) configurables par la marque. | M |
| FR-CAT-002 | Navigation par genre/catégorie et par étiquettes (ex. « Vengeance », « Mariage arrangé »). | M |
| FR-CAT-003 | Recherche plein texte sur titre, synopsis et étiquettes, tolérante aux accents. | M |
| FR-CAT-004 | Fiche série : affiche, bande-annonce, synopsis, genres, nombre d'épisodes, liste des épisodes avec statut (gratuit / débloqué / prix en crédits). | M |
| FR-CAT-005 | Classements « Populaires » (vues sur 7 jours) et « Nouveautés » (date de publication) calculés côté serveur par marque. | M |
| FR-CAT-006 | Métadonnées traduites FR/EN ; repli sur la langue d'origine si traduction absente. | M |
| FR-CAT-007 | Une série/épisode n'apparaît que si : publié par la marque **et** licence valide pour le pays de l'utilisateur à la date courante **et** fenêtre de disponibilité ouverte. | M |
| FR-CAT-008 | Pages série indexables par les moteurs de recherche (rendu serveur, métadonnées Open Graph, sitemap par marque). | M |

### 7.3 Lecture vidéo (`FR-VIDEO`)

| ID | Exigence | Prio |
|---|---|---|
| FR-VIDEO-001 | Lecture en **streaming adaptatif HLS** (240p → 720p au MVP) sur web mobile, web desktop, Android, iOS. | M |
| FR-VIDEO-002 | Lecteur vertical plein écran ; passage à l'épisode suivant par glissement vertical et enchaînement automatique. | M |
| FR-VIDEO-003 | **Reprise de lecture** : position sauvegardée toutes les 10 s et à la sortie, restaurée à l'ouverture. | M |
| FR-VIDEO-004 | Sous-titres FR/EN activables, choix mémorisé. | M |
| FR-VIDEO-005 | **Mode économie de données** : plafonne la qualité à 360p ; activé par défaut sur réseau cellulaire (modifiable). | M |
| FR-VIDEO-006 | Le flux d'un épisode payant n'est délivré qu'après vérification serveur du droit d'accès, via une **URL signée à durée limitée** ; une URL partagée expire. | M |
| FR-VIDEO-007 | Indicateur de mise en mémoire tampon et reprise automatique après coupure réseau. | M |
| FR-VIDEO-008 | Téléchargement hors ligne. | L |
| FR-VIDEO-009 | DRM (Widevine/FairPlay). | L — sauf si exigé par un contrat de licence (Q-06) |

### 7.4 Bibliothèque personnelle (`FR-LIB`)

| ID | Exigence | Prio |
|---|---|---|
| FR-LIB-001 | Favoris (« Ma liste ») : ajouter/retirer une série. | M |
| FR-LIB-002 | « Continuer à regarder » : dernières séries entamées avec épisode et position. | M |
| FR-LIB-003 | Historique des épisodes débloqués. | M |

### 7.5 Monétisation (`FR-MON`)

| ID | Exigence | Prio |
|---|---|---|
| FR-MON-001 | Nombre d'épisodes gratuits configurable par série (défaut 5) et surchargeable par marque. | M |
| FR-MON-002 | Portefeuille de crédits par utilisateur **et par marque**, avec solde et relevé des mouvements. | M |
| FR-MON-003 | Déblocage d'un épisode contre N crédits (prix par série, surchargeable par épisode et par marque). Un épisode débloqué l'est définitivement pour cet utilisateur dans cette marque. | M |
| FR-MON-004 | Option « déblocage automatique de l'épisode suivant » (désactivée par défaut, confirmation du solde). | S |
| FR-MON-005 | Packs de crédits par marque, par devise (ex. 500 XOF = 50 crédits ; 2 000 XOF = 220 crédits). | M |
| FR-MON-006 | Crédits bonus (promotions, geste commercial) distincts des crédits payés, avec date d'expiration optionnelle ; les crédits bonus sont consommés en premier. | S |
| FR-MON-007 | Débloquer toute une série à prix réduit. | L |
| FR-MON-008 | Abonnement (VIP mensuel). | L |
| FR-MON-009 | Publicité récompensée (regarder une publicité = crédits). | L |

### 7.6 Paiement (`FR-PAY`)

| ID | Exigence | Prio |
|---|---|---|
| FR-PAY-001 | Adaptateur **Wave direct** (Checkout API), activable par configuration pour réduire les frais ou en secours. | S |
| FR-PAY-002 | Achat par **PayTech** — **canal principal** : Wave, Orange Money, Free Money et carte bancaire, encaissés sur le compte PayTech de la plateforme. | M |
| FR-PAY-003 | Adaptateur **PayDunya** (agrégateur de secours, activable par configuration). | S |
| FR-PAY-004 | Adaptateur **Orange Money direct** (Sonatel). | L |
| FR-PAY-005 | Les moyens de paiement proposés dépendent du **pays** de l'utilisateur, de la **devise** et de la **configuration de la marque**. | M |
| FR-PAY-006 | Les crédits sont attribués **uniquement** après confirmation serveur du paiement (notification signée **et** vérification du statut auprès du fournisseur). Une redirection navigateur ne suffit jamais. | M |
| FR-PAY-007 | Écran « paiement en cours » qui interroge le serveur et se met à jour automatiquement ; reprise possible après fermeture de l'application. | M |
| FR-PAY-008 | Historique des achats et reçu (référence, montant, devise, moyen, date). | M |
| FR-PAY-009 | Remboursement initié par la finance plateforme, avec reprise des crédits non consommés et journal d'audit. | M |
| FR-PAY-010 | Rapprochement quotidien automatique avec les fournisseurs ; écarts signalés au back-office. | M |
| FR-PAY-011 | Expiration des commandes non payées (30 min par défaut). | M |
| FR-PAY-012 | Achat de packs par **Google Play Billing** dans l'application Android, vérifié côté serveur, crédité dans le même portefeuille. | L (phase 2) |
| FR-PAY-013 | Achat de packs par **achat intégré App Store** dans l'application iOS, vérifié côté serveur, crédité dans le même portefeuille. | L (phase 2) |
| FR-PAY-014 | Les crédits achetés sur un canal (web, Android, iOS) sont utilisables sur tous les canaux de la même marque. | M (web) / L (apps) |

### 7.7 Notifications (`FR-NOTIF`)

| ID | Exigence | Prio |
|---|---|---|
| FR-NOTIF-001 | SMS pour l'OTP. | M |
| FR-NOTIF-002 | Notification in-app de confirmation de paiement / échec. | M |
| FR-NOTIF-003 | Centre de notifications in-app (nouvel épisode d'une série favorite, promotions). | S |
| FR-NOTIF-004 | Notifications push mobiles. | L (avec l'app store) |

### 7.8 Back-office catalogue (`FR-ADM`) — plateforme

| ID | Exigence | Prio |
|---|---|---|
| FR-ADM-001 | CRUD séries (titres FR/EN, synopsis, genres, étiquettes, affiche, bande-annonce, statut). | M |
| FR-ADM-002 | CRUD épisodes, réordonnancement, téléversement vidéo reprenable, suivi d'encodage. | M |
| FR-ADM-003 | Téléversement des sous-titres (WebVTT) par langue. | M |
| FR-ADM-004 | **Licences** : ayant droit, référence du contrat, pièce jointe du contrat, territoires, dates de début/fin, droit de sous-licence aux marques tierces ; une série sans licence valide ne peut pas être publiée. | M |
| FR-ADM-009 | **Import en lot** du catalogue (manifeste CSV + dossier ou bucket de fichiers vidéo, affiches, sous-titres), reprenable, avec rapport d'erreurs par épisode. | M |
| FR-ADM-005 | Planification de publication (date/heure). | S |
| FR-ADM-006 | Assistance : rechercher un utilisateur, voir achats/solde, ajuster des crédits (motif obligatoire, audité). | M |
| FR-ADM-007 | Commandes, paiements, remboursements, écarts de rapprochement. | M |
| FR-ADM-008 | Tableau de bord : vues, utilisateurs actifs, conversion, revenus par marque/pays/fournisseur. | S |

### 7.9 Gestion des marques (`FR-TEN`)

| ID | Exigence | Prio |
|---|---|---|
| FR-TEN-001 | Créer, suspendre, réactiver une marque (super-admin). | M |
| FR-TEN-002 | Domaines et sous-domaines de la marque (ex. `marque.gaatshort.com`, `www.marque.sn`) avec vérification DNS. | M |
| FR-TEN-003 | Branding : nom, logo, icône, couleurs, typographie (choix dans une liste), textes légaux (CGU, confidentialité). | M |
| FR-TEN-004 | Pays ouverts, devises, langues, moyens de paiement actifs. | M |
| FR-TEN-005 | Sélection des séries publiées parmi le catalogue licencié **sous-licenciable** ; tarification propre. | M |
| FR-TEN-006 | Utilisateurs et rôles back-office de la marque. | M |
| FR-TEN-007 | Rapport de revenus et de reversement de la marque. | S |
| FR-TEN-008 | Comptes marchands propres à la marque. | L (D-07) |

## 8. Exigences non fonctionnelles

| ID | Exigence | Cible MVP |
|---|---|---|
| NFR-SEC-001 | **Isolation des marques** : aucune donnée d'une marque (rattachements, portefeuilles, commandes, droits, historique, configuration) n'est lisible ou modifiable depuis une autre, y compris en manipulant un identifiant d'URL, un en-tête ou un jeton. Double rempart applicatif + RLS PostgreSQL, testé en CI. | Bloquant |
| NFR-SEC-002 | Conformité visée OWASP ASVS niveau 2 pour l'API. | Revue avant prod |
| NFR-SEC-003 | Aucun secret dans le code ni dans Git ; secrets fournisseurs chiffrés au repos. | Bloquant |
| NFR-SEC-004 | Limitation de débit par IP, par numéro (OTP), par utilisateur, par marque. | Bloquant |
| NFR-SEC-005 | Journal d'audit immuable des actions sensibles (crédits, remboursements, prix, licences, rôles). | Bloquant |
| NFR-PERF-001 | Temps avant la première image d'un épisode ≤ 2,5 s (p75) sur 4G, ≤ 4 s sur 3G. | Mesuré en recette |
| NFR-PERF-002 | API : p95 ≤ 300 ms hors appels fournisseurs. | Mesuré |
| NFR-PERF-003 | Web : LCP ≤ 2,5 s (p75) sur mobile 4G ; poids initial de la page d'accueil ≤ 300 Ko hors images. | Mesuré |
| NFR-AVAIL-001 | Disponibilité mensuelle de l'API ≥ 99,5 %. | Supervisé |
| NFR-DATA-001 | Sauvegardes PostgreSQL : RPO ≤ 15 min (archivage WAL), RTO ≤ 4 h ; restauration testée mensuellement. | Testé avant prod |
| NFR-OBS-001 | Logs corrélés, métriques, traces, alertes paiement et lecture. | Bloquant |
| NFR-I18N-001 | Toute chaîne visible est traduisible ; montants formatés selon devise (XOF sans décimale, GMD 2 décimales). | Bloquant |
| NFR-A11Y-001 | WCAG 2.1 AA sur le web ; cibles tactiles ≥ 44 px ; sous-titres disponibles. | Revue |
| NFR-COMP-001 | Protection des données personnelles conforme au droit sénégalais et gambien (consentements, droits d'accès/effacement, déclaration auprès de l'autorité). | **[À CONFIRMER]** par juriste |
| NFR-MONEY-001 | Montants stockés en **entiers en unité mineure** ; aucune conversion monétaire implicite ; aucune arithmétique flottante. | Bloquant |

## 9. Périmètre MVP

**Inclus (M)** : tout ce qui est marqué M ci-dessus, sur **site web/PWA** + back-office, avec **PayTech** comme seul fournisseur obligatoire et le catalogue de **100 séries** importé.

**Souhaitable (S)** : OTP e-mail, déblocage automatique, crédits bonus, Wave direct, PayDunya, centre de notifications, planification, tableau de bord, rapport de reversement.

**Reporté (L)** : applications Android puis iOS avec achats intégrés (phase 2, voir §11.4), push, hors-ligne, DRM, abonnement, publicité, Orange Money direct, Wave Gambie et prix en GMD, comptes marchands propres aux marques, série complète à prix réduit, autres pays.

## 10. Modèle économique (proposé)

- **Gratuit** : les N premiers épisodes de chaque série (aimant d'audience).
- **Crédits** : packs vendus par la marque (prix indicatifs à fixer par marque, ex. 500 XOF → 50 crédits ; 1 000 XOF → 105 ; 2 000 XOF → 220 ; 5 000 XOF → 600). Un épisode payant coûte typiquement 10 à 20 crédits.
- **Débit** : chaque épisode payant est débité directement des crédits de l'utilisateur, au prix fixé par la marque (ex. 15 crédits).
- **Reversement** : la plateforme encaisse sur son compte PayTech, déduit les frais fournisseurs et sa commission, et reverse à la marque. Le taux et la fréquence ne sont pas encore fixés (Q-12) : le taux est un paramètre par marque, les rapports calculent brut, frais et net.
- **Applications store (phase 2)** : les packs vendus en achat intégré ont un prix plus élevé, pour absorber la commission du store (15 % à 30 % selon le programme). Pour les applications des marques tierces publiées sous leur propre compte développeur, l'argent des stores arrive chez la marque et c'est la plateforme qui facture sa part (TRD §16.4).
- **Évolution** : abonnement VIP (accès illimité), publicité récompensée, série complète.

## 11. Exigences spécifiques paiement, streaming et stores

### 11.1 Paiement — constats vérifiés au 2026-10-19

| Fournisseur | Pays couverts (constat) | Devises | Notification serveur | Remboursement API | Bac à sable |
|---|---|---|---|---|---|
| **Wave** (Checkout API) | Sénégal ; Gambie avec un **compte Wave Business gambien distinct** | XOF (sans décimales) ; GMD **[À CONFIRMER]** | Webhook signé HMAC (`Wave-Signature`) | Oui (`/refund`, idempotent) | Pas de bac à sable connu → tests à faible montant **[À CONFIRMER]** |
| **PayTech** | Sénégal (+ CI, ML, BJ) | XOF, EUR, USD, CAD, GBP, MAD — **pas de GMD** | IPN avec `hmac_compute` (HMAC-SHA256) | Oui (`refund-payment`) | Oui, mais **débite réellement 100–150 XOF** |
| **PayDunya** | SN, CI, BJ, BF, ML, TG — **pas la Gambie** | XOF | IPN | **[À CONFIRMER]** | Oui (mode test) |
| **Orange Money** (Sonatel) | Sénégal uniquement (pas d'Orange en Gambie) | XOF | Notification non garantie selon les sources → interrogation de statut | Pas d'API publique de remboursement selon les sources **[À CONFIRMER]** | Oui |

Conséquence : **au Sénégal**, PayTech seul couvre Wave, Orange Money, Free Money et carte, et c'est sur ce compte que la plateforme encaisse (D-07). Wave direct et PayDunya restent des adaptateurs de secours. **En Gambie**, seul Wave (compte gambien) est identifié pour le mobile money ; les portefeuilles gambiens Afrimoney et QMoney ne sont couverts par aucun des quatre fournisseurs retenus.

### 11.2 Streaming
Voir TRD §7. Recommandation : **Bunny Stream** derrière une interface interne remplaçable (encodage H.264 gratuit jusqu'en 1080p, CDN, authentification par jeton, DRM optionnel). Pour 100 séries (≈ 200 h de vidéo), un pipeline S3 + transcodage maison coûterait plus cher en serveurs et en exploitation que Bunny, dont l'encodage standard est gratuit (TRD §7.5).

### 11.3 Gambie — sans compte Wave Business (Q-07)
Il n'existe pas de compte Wave Business gambien à ce jour. Vendre en GMD suppose ce compte, et probablement une entité ou un enregistrement local **[À CONFIRMER]**. Décision proposée (D-12) :
- **Au lancement** : épisodes gratuits pour tous. Achat de packs par **carte bancaire via PayTech, prix affichés en XOF** : la banque de l'utilisateur convertit, la plateforme ne fait aucune conversion. Condition : PayTech accepte les cartes émises en Gambie (Q-11). Sinon, la Gambie est en visionnage gratuit uniquement, avec un message « Achat bientôt disponible ».
- **Ensuite** : ouverture d'un compte Wave Business en Gambie, packs en GMD, Wave Gambie activé par configuration, sans développement supplémentaire (l'adaptateur Wave existe déjà, FR-PAY-001).
- La configuration de la marque porte la devise par pays (`tenant_countries.currency_code`), ce qui permet de passer la Gambie de XOF à GMD sans migration.

### 11.4 Stores mobiles — stratégie retenue (Q-04)
**Contraintes vérifiées au 2026-10-19 :**
- **Apple** (règle 3.1.1) impose l'achat intégré pour débloquer du contenu, y compris par monnaie virtuelle. La règle 3.1.3(b) autorise l'application à donner accès aux contenus achetés sur le web **à condition que ces mêmes articles soient aussi vendus en achat intégré** dans l'application.
- **Google Play** impose sa facturation pour les contenus numériques et interdit d'orienter l'utilisateur vers un autre moyen de paiement. En revanche, il autorise toute application à être en « consommation seule » de contenus achetés ailleurs. Ses programmes de facturation alternative ne couvrent ni le Sénégal ni la Gambie aujourd'hui ; son programme mondial n'est annoncé pour le « reste du monde » qu'à l'horizon fin septembre 2027.
- **Apple** (règle 4.2.6) : une application issue d'un modèle ou d'un service de génération d'applications doit être soumise **par le fournisseur du contenu**, c'est-à-dire sous le compte développeur de la marque. Formulation datant de 2017, **[À CONFIRMER]** sur la version actuelle des règles.

**Stratégie retenue (D-11) :**

| Étape | Canal | Achat | Pourquoi |
|---|---|---|---|
| 1 — MVP | **PWA** (site installable), toutes marques | Mobile money et carte via **PayTech** | Aucune commission, aucun risque de rejet, mise sur le marché la plus rapide |
| 2 — Phase 2a | **Android** sur Google Play | **Google Play Billing** pour les packs, prix majorés ; les crédits déjà achetés sur le web restent utilisables | Android domine au Sénégal ; conforme aux règles de Google sans bloquer l'utilisateur au 6ᵉ épisode |
| 3 — Phase 2b | **iOS** sur l'App Store | **Achat intégré Apple** pour les packs, prix majorés ; crédits web utilisables (règle 3.1.3(b)) | Conforme aux règles 3.1.1 et 3.1.3(b) |

Règles communes aux applications :
- Aucun lien, bouton ou texte orientant vers l'achat sur le web.
- Un seul portefeuille par utilisateur et par marque, quel que soit le canal d'achat (FR-PAY-014).
- Vérification serveur de chaque achat store, comme pour PayTech.
- La **marque maison** est publiée sous le compte développeur de la plateforme. Chaque **marque tierce** est publiée sous son propre compte, à partir du même code et de builds paramétrés.
- Le mobile money **dans** l'application est exclu tant qu'aucun programme de facturation alternative n'est ouvert pour ces pays. La stratégie est à réexaminer quand Google étendra son programme mondial (horizon annoncé : fin septembre 2027).

Écartés : application en consommation seule (l'utilisateur ne peut plus rien acheter ni savoir où acheter dès le 6ᵉ épisode) ; distribution d'APK hors Google Play (avertissements de sécurité Android, faible confiance), réservée à des cas particuliers.

## 12. Exigences multi-tenant (synthèse)

- Résolution de la marque par **domaine** (web), par **identifiant de build** (applications par marque), par le **jeton** (utilisateur connecté).
- Chaque marque a son branding, ses domaines, ses pays, ses langues, ses moyens de paiement, ses prix et sa sélection du catalogue.
- Le catalogue, les médias et les licences sont **globaux** (détenus par la plateforme), en lecture seule pour les marques.
- Les comptes utilisateurs sont **globaux**, mais une marque ne voit que les utilisateurs **rattachés** à elle, et seulement leurs données dans cette marque.
- Back-office unique avec deux niveaux : **plateforme** (tous tenants) et **marque** (un seul tenant).

## 13. Critères d'acceptation globaux du MVP

1. Un visiteur anonyme regarde les 5 premiers épisodes d'une série sur un Android d'entrée de gamme en 4G sans créer de compte.
2. Au 6ᵉ épisode, il se connecte par OTP SMS, achète un pack via PayTech (Wave ou Orange Money), et l'épisode est lu, débité de ses crédits ; les crédits n'apparaissent qu'après confirmation serveur.
3. Une notification PayTech rejouée 5 fois ne crédite qu'une seule fois.
4. Une notification falsifiée (signature invalide) est rejetée, journalisée et ne crédite rien.
5. Un paiement validé alors que l'utilisateur a fermé l'application est crédité et visible à la réouverture.
6. Un administrateur de la marque A ne peut ni lister ni ouvrir un utilisateur, une commande ou une statistique de la marque B, quel que soit l'identifiant envoyé (test automatisé).
7. L'URL de lecture d'un épisode payant cesse de fonctionner après expiration et n'est délivrée qu'à un utilisateur ayant le droit.
8. Une série dont la licence a expiré disparaît du catalogue de toutes les marques sans action manuelle ; une série sans droit de sous-licence n'est jamais proposée à une marque tierce.
9. Le rapprochement quotidien signale un paiement réussi chez le fournisseur sans crédit correspondant.
10. La restauration d'une sauvegarde de production sur un environnement de test a été réalisée avec succès et chronométrée.

## 14. Indicateurs de réussite

Activation (≥ 1 épisode lu), profondeur (épisodes par session), taux de passage du dernier épisode gratuit au premier payant, conversion payante, panier moyen, ARPPU, taux d'échec paiement par fournisseur, délai paiement→crédit, temps de démarrage vidéo, taux de mise en mémoire tampon, coût CDN par heure regardée, rétention J1/J7/J30.

## 15. Risques, dépendances et hypothèses

| ID | Risque | Impact | Atténuation |
|---|---|---|---|
| R-01 | Règles de facturation des stores (§11.4) | Rejet des applications, commission 15–30 % | PWA d'abord ; décision Q-04 |
| R-02 | **Droits non documentés** : les séries proviennent de plusieurs plateformes et les droits de sous-licence aux marques ne sont pas connus (Q-06). Acheter une vidéo pour la regarder ne donne aucun droit de la diffuser : seul un contrat de licence de distribution le fait. | **Élevé** : diffusion illicite, retrait de catalogue, catalogue des marques tierces potentiellement vide | Registre des licences en P0, **bloquant** (contrat par série : territoires SN/GM, durée, streaming payant, sous-licence) ; aucune publication sans licence (FR-ADM-004) ; sous-licence refusée par défaut ; lancement possible sur la **marque maison** (D-13) |
| R-03 | Pas de compte Wave Business en Gambie | Revenus gambiens limités aux paiements par carte | D-12 ; ouvrir le compte Wave Gambie en parallèle |
| R-04 | Fournisseur de paiement indisponible | Perte de ventes | Plusieurs adaptateurs, bascule par configuration |
| R-05 | Coût de bande passante vidéo en Afrique | Marge négative | Plafond 720p, économie de données par défaut, suivi du coût par heure regardée |
| R-06 | Fraude (notifications forgées, partage de liens, rejeu) | Perte de revenus | §FR-PAY-006, URLs signées courtes, limites de débit |
| R-07 | Wave sans bac à sable | Tests coûteux, régressions | Simulateur interne de fournisseur + tests réels à faible montant documentés |
| R-08 | Données personnelles partagées entre marques tierces (compte unique) | Non-conformité | Consentement par marque, isolation stricte, avis juriste (Q-08) |
| R-09 | **Volume d'ingestion** : ~6 000 épisodes à importer, encoder, titrer et sous-titrer | Retard du lancement, erreurs éditoriales | Import en lot dès P2 (FR-ADM-009) ; téléversement depuis un serveur et non depuis un poste à Dakar ; profil « opérateur de contenu » dédié ; lancement possible avec un sous-ensemble prêt |
| R-10 | Sous-titres FR/EN absents des livraisons | Gambie non servie, accessibilité | Inventaire en P0 (Q-10) ; transcription automatique Bunny en option (0,10 $ par minute et par langue) + relecture humaine |
| R-11 | Règles des stores (§11.4) mal interprétées ou modifiées | Rejet d'application | PWA d'abord ; revue des règles à jour avant chaque soumission ; échange préalable avec la revue Apple |

**Hypothèses** : épisodes de 1 à 3 min en 9:16 ; **100 séries** d'environ 60 épisodes en moyenne (≈ 6 000 épisodes, ≈ 200 h de vidéo — Q-10) ; trafic initial < 10 000 utilisateurs actifs mensuels.

## 16. Points légaux et droits de diffusion à valider

- Contrats de licence, pour **chacune des 100 séries** : identité de l'ayant droit, territoires (SN, GM), durée, mode d'exploitation autorisé (streaming à l'acte ou par crédits), langues, **sous-licence à des tiers**, exigences de protection (DRM ?), obligations de reporting à l'ayant droit. Une preuve d'achat de vidéos sur une plateforme grand public ne vaut pas licence de diffusion.
- Stores : comptes développeur Apple et Google de la plateforme (marque maison) et de chaque marque tierce ; conditions commerciales des stores.
- Protection des données : déclaration auprès de la CDP (Sénégal) ; cadre gambien applicable ; transfert hors pays (hébergement OVH en Europe, CDN mondial).
- Fiscalité : TVA sur services numériques (Sénégal, Gambie), facturation des marques, retenues sur reversements **[À CONFIRMER]** avec un comptable.
- Mentions légales et CGU par marque ; politique de remboursement.

## 17. Questions ouvertes (à trancher par le porteur)

| ID | Question | Réponse / proposition | Statut |
|---|---|---|---|
| Q-01 | Accès payant par crédits ? | 5 premiers épisodes gratuits, les suivants débités directement des crédits | **Répondu** → D-05, D-06 |
| Q-02 | Achats et crédits propres à chaque marque (D-04) ? | Proposition : oui | **Ouvert** |
| Q-03 | Qui encaisse ? Taux de partage ? | La plateforme, sur son compte PayTech ; taux inconnu | **Répondu** → D-07 ; taux → Q-12 |
| Q-04 | Stratégie stores | Mise en place demandée : PWA, puis Android et iOS avec achats intégrés | **Répondu** → D-11, §11.4 |
| Q-05 | 100 épisodes ou 100 séries ? | 100 séries | **Répondu** → D-09 |
| Q-06 | Les licences autorisent-elles la diffusion par des marques tierces ? | Inconnu ; vidéos achetées sur différentes plateformes | **Répondu** → D-13, R-02 (registre des licences bloquant) |
| Q-07 | Compte Wave Business en Gambie ? | Pas pour le moment | **Répondu** → D-12 |
| Q-08 | Nom définitif de la plateforme et de la marque maison ; mention du compte unique (« compte Gaatshort ») ? | Proposition : « Gaatshort » pour la marque maison, mention discrète du compte | **Ouvert** |
| Q-09 | Une première marque tierce pilote est-elle identifiée ? | Proposition : lancement sur la marque maison | **Ouvert** |
| Q-10 | Nombre réel d'épisodes par série, durée moyenne, format des fichiers livrés (résolution, vertical ?), sous-titres FR/EN fournis ou non ? | Hypothèse : 60 épisodes de ~2 min, 1080×1920, sous-titres à vérifier | **Nouveau** |
| Q-11 | PayTech accepte-t-il les cartes bancaires émises en Gambie ? | À demander à PayTech | **Nouveau** |
| Q-12 | Taux et fréquence de reversement aux marques tierces | Paramètre par marque, à fixer par contrat | **Nouveau** |
