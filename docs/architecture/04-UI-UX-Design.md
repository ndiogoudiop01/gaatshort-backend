# 04 — UI/UX Design · Direction artistique, design system et écrans

| | |
|---|---|
| Version | 0.2 — **brouillon soumis à validation** (0.2 : écran BO-17 Imports, règles d'interface des applications store, Gambie) |
| Date | 2026-10-19 |
| Références | Parcours : [03-APPFLOW](03-APPFLOW.md) · Exigences : [01-PRD](01-PRD.md) |

> **Statut des maquettes.** Ce document est une **spécification textuelle**. Aucune maquette ni prototype n'a encore été réalisé. Des maquettes haute fidélité des écrans SCR-01, SCR-04, SCR-05, SCR-06, SCR-07, SCR-09 et BO-11 sont prévues dès validation de la direction artistique (§1) — voir 06-IMPLEMENTATION-PLAN, tâche T0.4.

---

## 1. Direction artistique

DramaBox sert de **référence d'usage** (format vertical, rangées, déblocage par crédits), pas de référence visuelle : aucune couleur, typographie, iconographie, texte ou visuel n'en est repris.

**Concept proposé : « Nuit de Dakar ».** Les séries se regardent surtout le soir, sur téléphone, dans la pénombre. L'interface s'efface derrière les affiches : fond très sombre légèrement violacé (ni noir pur, ni gris neutre), un accent chaud unique inspiré du **bissap** pour l'action principale, et un or **safran** réservé à tout ce qui touche aux crédits. Formes généreusement arrondies, typographie expressive pour les titres, sobre pour le reste.

| Principe | Traduction |
|---|---|
| Le contenu d'abord | Affiches plein cadre, chrome minimal, aucun fond décoratif |
| Une seule action principale par écran | Un seul bouton bissap visible à la fois |
| L'argent est lisible | Toute valeur en crédits est en safran avec l'icône pièce ; tout montant en monnaie est écrit en entier (« 2 000 FCFA », « D 150.00 ») |
| Rapide avant d'être joli | Aucune animation bloquante ; images en WebP/AVIF dimensionnées ; squelettes au lieu de spinners |
| Marque blanche sans casse | Les marques changent couleurs, logo, police et textes — jamais la structure, l'espacement ou les composants |

## 2. Identité visuelle par défaut (thème plateforme)

### 2.1 Couleurs (jetons sémantiques)

| Jeton | Valeur sombre (défaut) | Valeur claire (back-office) | Usage |
|---|---|---|---|
| `--bg` | `#0F0B14` | `#F7F5FA` | Fond d'application |
| `--surface-1` | `#18131F` | `#FFFFFF` | Cartes, feuilles |
| `--surface-2` | `#231C2C` | `#EFEAF4` | Champs, éléments au survol |
| `--border` | `#2F2639` | `#DCD3E5` | Séparateurs |
| `--text` | `#F4EFF8` | `#1A1422` | Texte principal |
| `--text-muted` | `#A99DB6` | `#5E5369` | Texte secondaire (contraste ≥ 4,5:1 vérifié sur `--bg`) |
| `--accent` | `#E0325E` (bissap) | `#B81E47` | Action principale, progression du lecteur |
| `--accent-contrast` | `#FFFFFF` | `#FFFFFF` | Texte sur accent |
| `--coin` | `#F5B33B` (safran) | `#9A6400` | Crédits, prix en crédits |
| `--success` | `#3CCB7F` | `#1E7F4C` | Paiement confirmé |
| `--warning` | `#F2C14E` | `#8A6100` | Paiement en cours |
| `--danger` | `#FF6B5E` | `#B3261E` | Échec, suppression |
| `--focus` | `#8AB4FF` | `#1F5BD6` | Anneau de focus (2 px + décalage 2 px) |

Une marque peut redéfinir **uniquement** : `--accent`, `--accent-contrast`, `--coin` (optionnel), le logo, l'icône, la police d'affichage. Le back-office refuse une couleur d'accent dont le contraste avec `--accent-contrast` est < 4,5:1 ou dont le contraste avec `--bg` est < 3:1.

### 2.2 Typographie

| Rôle | Police par défaut | Alternatives proposées aux marques | Tailles (mobile) |
|---|---|---|---|
| Affichage (titres de série, en-têtes) | **Bricolage Grotesque** (700) | Fraunces, Unbounded, Playfair Display | 28 / 22 / 18 |
| Texte | **Figtree** (400/500/600) | — (fixe pour la lisibilité) | 16 corps, 14 secondaire, 12 légende |
| Chiffres (prix, durées) | Figtree, chiffres tabulaires | — | — |

Polices auto-hébergées, sous-ensembles latins étendus (français, anglais), `font-display: swap`. Interligne 1,5 pour le corps.

### 2.3 Espacement, rayons, élévation

- Grille de 4 px ; espacements utilisés : 4, 8, 12, 16, 24, 32, 48.
- Gouttière latérale mobile : 16 px.
- Rayons : 8 (champs, puces), 12 (cartes), 20 (feuilles du bas), 999 (boutons pilule).
- Élévation par contraste de surface, pas par ombres portées (sur fond sombre elles ne se voient pas et coûtent au rendu).

### 2.4 Iconographie et images

- Jeu d'icônes **Lucide** (déjà utilisé par le socle web), trait 1,75 px.
- Pièce de crédit : icône originale (cercle safran avec un motif de vague) dessinée pour la plateforme.
- Affiches 2:3 et 9:16 ; bannières 16:9 (web) recadrées automatiquement en 4:5 sur mobile ; dégradé `--bg` en bas des affiches pour la lisibilité des titres.

## 3. Principes de navigation et architecture de l'information

- **Mobile (PWA et apps)** : barre basse à 4 entrées — Accueil, Découvrir, Ma liste, Profil. Le lecteur s'ouvre en plein écran par-dessus la navigation.
- **Desktop web** : barre supérieure (logo, Accueil, Découvrir, recherche, solde, profil) ; le lecteur s'affiche au centre au format vertical, avec la liste des épisodes à droite.
- Profondeur maximale : 3 niveaux (Accueil → Fiche → Lecteur).
- Le retour système (geste ou bouton) ramène toujours à l'écran précédent, jamais à l'accueil par surprise.

```
Accueil
 ├─ Bannière à la une → Lecteur
 ├─ Continuer à regarder → Lecteur (reprise)
 ├─ Rangées → Fiche série → Lecteur ↔ Feuille de déblocage → Boutique → Paiement
Découvrir
 ├─ Genres → Liste filtrée → Fiche série
 └─ Recherche → Fiche série
Ma liste
 ├─ Continuer
 └─ Favoris
Profil
 ├─ Portefeuille & achats
 ├─ Notifications
 └─ Réglages (langue, qualité, sous-titres, compte)
```

## 4. Composants

| Composant | Variantes / états | Règles |
|---|---|---|
| **Bouton** | primaire (accent), secondaire (contour), fantôme, crédit (safran), danger ; tailles M (44 px) et L (52 px) ; états repos/survol/pressé/désactivé/chargement | Le libellé décrit l'action (« Débloquer pour 15 », pas « OK ») ; état chargement conserve la largeur |
| **Carte série** | portrait 2:3 (rangées), paysage (continuer à regarder, avec barre de progression), classement (numéro en grand) | Badge « Nouveau », « Gratuit » ; titre sur 2 lignes max |
| **Rangée** | titre + « Tout voir » ; défilement horizontal avec accroche (scroll-snap) | 2,5 cartes visibles sur mobile pour signaler le défilement |
| **Bannière à la une** | image, titre, genres, bouton « Regarder » | Rotation manuelle (pas d'auto-défilement : accessibilité, data) |
| **Lecteur vertical** | lecture, pause, mise en tampon, erreur, fin d'épisode, épisode verrouillé | Commandes masquées après 3 s ; zone de tap = pause ; barre de progression fine en bas, épaisse au toucher ; boutons à droite : favori, épisodes, sous-titres, partager |
| **Feuille de déblocage** (bottom sheet) | solde suffisant / insuffisant / non connecté / chargement / erreur | Affiche prix, solde, solde après déblocage |
| **Carte de pack** | standard, « Meilleure valeur », « Bonus +10 % » | Prix en monnaie en grand, crédits en safran |
| **Sélecteur de moyen de paiement** | Wave, Orange Money, Free Money, Carte | Logos officiels utilisés **conformément aux chartes des fournisseurs** ; seuls les moyens disponibles pour le pays sont affichés |
| **Écran d'état** | vide, erreur, hors ligne, indisponible dans le pays | Illustration légère (SVG < 4 Ko), message, une action |
| **Champ téléphone** | indicatif pays (liste restreinte aux pays de la marque) + numéro masqué par format | Clavier numérique, validation E.164 |
| **Champ OTP** | 6 cases, collage et remplissage automatique (`autocomplete="one-time-code"`) | Erreur sous le champ, jamais par alerte modale |
| **Toast** | info, succès, erreur, avec action « Annuler » | 4 s, pas de superposition |
| **Modale** | confirmation destructive uniquement | Les autres choix passent par des feuilles du bas |

## 5. Comportement responsive

| Point de rupture | Disposition |
|---|---|
| < 600 px | Mobile : 1 colonne, barre basse, lecteur plein écran |
| 600–1023 px | Tablette : rangées à 4–5 cartes, lecteur vertical centré |
| ≥ 1024 px | Desktop : barre supérieure, grilles à 6 cartes, lecteur vertical + panneau épisodes |

Le back-office est conçu desktop d'abord (≥ 1280 px) et reste utilisable sur tablette ; il n'est pas optimisé pour mobile.

## 6. États

| État | Traitement |
|---|---|
| Chargement | Squelettes à la forme exacte du contenu ; le lecteur affiche l'affiche en flou + indicateur de tampon |
| Erreur récupérable | Message + « Réessayer » ; le contenu déjà chargé reste visible |
| Erreur bloquante | Écran d'état avec code de référence (`requestId` abrégé) pour le support |
| Succès | Confirmation brève (toast ou écran SCR-09) ; pas de confettis |
| Vide | Ma liste vide → « Ajoutez des séries avec ♡ » + rangée Populaires |
| Indisponible | « Cette série n'est pas disponible dans votre pays » |
| Hors ligne | Bandeau persistant en haut, actions de paiement désactivées |

## 7. Accessibilité (NFR-A11Y-001)

- Contrastes AA vérifiés sur les jetons ; vérification automatique des couleurs de marque.
- Cibles tactiles ≥ 44 × 44 px ; espacement ≥ 8 px entre cibles.
- Navigation clavier complète sur le web (lecteur : espace, flèches haut/bas pour épisode, `c` sous-titres) ; focus visible.
- Libellés accessibles sur toutes les icônes ; annonces `aria-live` pour solde mis à jour et statut de paiement.
- Sous-titres stylés (fond semi-opaque, taille réglable en 3 crans).
- Respect de `prefers-reduced-motion`.
- Pas d'information portée par la couleur seule (statuts avec icône + texte).

## 8. Expérience sur réseau mobile lent

- Page d'accueil web : HTML rendu serveur, CSS critique en ligne, JavaScript initial ≤ 150 Ko compressé, images en `srcset` (affiches ≤ 25 Ko en 2:3 à 240 px).
- Préchargement du **manifeste HLS** de l'épisode suivant (pas des segments) pendant la lecture ; préchargement du premier segment seulement si l'utilisateur est en Wi-Fi.
- Démarrage du lecteur en qualité basse puis montée (préférence `startLevel` bas).
- Mode économie de données visible dans le lecteur (icône) et dans les réglages.
- Indication du poids approximatif d'un épisode dans les réglages (« ~9 Mo par épisode en mode économie »).
- Service worker : vitrine, fiches et images déjà vues disponibles hors ligne ; aucun segment vidéo mis en cache au MVP.

## 9. Expérience de paiement sur mobile

1. **Peu d'étapes** : feuille de déblocage → pack (présélection du pack qui couvre le manque) → moyen (présélection du dernier utilisé) → paiement fournisseur → retour.
2. **Transparence** : avant de quitter l'app, récapitulatif « Vous allez payer **2 000 FCFA** avec **Wave** pour **220 crédits** ».
3. **Ouverture du fournisseur dans le navigateur ou l'application du fournisseur**, jamais dans une webview (exigence Wave).
4. **Retour** : SCR-09 « Paiement en cours » avec étapes (« Demande envoyée » → « En attente de confirmation » → « Crédits ajoutés »), délai indicatif, bouton « J'ai payé, vérifier » (déclenche une vérification serveur) et « Changer de moyen ».
5. **Jamais de faux succès** : l'écran ne passe au vert que lorsque l'API renvoie `SUCCEEDED`.
6. **Échec** : motif compréhensible (« Solde Wave insuffisant », « Paiement annulé ») et alternative immédiate.
7. **Gambie au lancement** : SCR-08 ne propose que « Carte bancaire », avec le prix en FCFA et la mention « Votre banque convertit le montant en dalasis ». Si la carte n'est pas disponible (Q-11), SCR-07 affiche « Achat bientôt disponible dans votre pays » et seuls les épisodes gratuits sont accessibles.

### 9.1 Applications store (phase 2)
- SCR-07 affiche les produits et les prix **renvoyés par le store** (dans la devise du store). SCR-08 n'existe pas : c'est la feuille de paiement native de Google ou d'Apple qui s'affiche.
- Aucun texte, lien ou bouton ne renvoie vers le site web pour acheter, et aucun prix web n'est affiché.
- SCR-09 s'affiche après la feuille native, le temps de la vérification serveur (« Vérification de votre achat… »), puis passe au succès.
- Le solde affiché est le même que sur le web.

## 10. Écrans utilisateur

| ID | Écran | Contenu principal | Flux | Exigences |
|---|---|---|---|---|
| SCR-01 | Accueil | Bannière à la une, rangées, solde (si connecté) | FLOW-04 | FR-CAT-001, 005 |
| SCR-02 | Genre | Grille de séries, tri (populaires / récentes) | FLOW-04 | FR-CAT-002 |
| SCR-03 | Recherche | Champ, résultats, suggestions | FLOW-05 | FR-CAT-003 |
| SCR-04 | Fiche série | Affiche, titre, genres, synopsis, bande-annonce, « Regarder / Reprendre », liste d'épisodes (gratuit / débloqué ✓ / prix), favori | FLOW-06 | FR-CAT-004 |
| SCR-05 | Lecteur vertical | Vidéo plein écran, commandes, épisodes, sous-titres | FLOW-06 | FR-VIDEO-* |
| SCR-06 | Feuille de déblocage | Prix, solde, action | FLOW-07 | FR-MON-003 |
| SCR-07 | Boutique crédits | Packs dans la devise locale | FLOW-08 | FR-MON-005 |
| SCR-08 | Moyen de paiement (web uniquement) | Liste filtrée par pays (SN : Wave, Orange Money, Free Money, carte ; GM : carte), récapitulatif | FLOW-08 | FR-PAY-002, 005 |
| SCR-09 | Paiement en cours / résultat | Étapes, statut, actions | FLOW-08 | FR-PAY-006, 007 |
| SCR-10 | Numéro | Indicatif + numéro, mention CGU | FLOW-01 | FR-AUTH-001 |
| SCR-11 | Code OTP | 6 cases, renvoi, changement de numéro | FLOW-01 | FR-AUTH-001 |
| SCR-12 | Onboarding marque | Langue, CGU/confidentialité de la marque, économie de données | FLOW-01, 02 | FR-AUTH-004 |
| SCR-13 | Ma liste | Continuer / Favoris | FLOW-11 | FR-LIB-* |
| SCR-14 | Profil & réglages | Préférences, compte, suppression | FLOW-10 | FR-AUTH-006, 007 |
| SCR-15 | Portefeuille & achats | Solde, mouvements, reçus | FLOW-09 | FR-MON-002, FR-PAY-008 |
| SCR-16 | Notifications | Liste, non lues | FLOW-11 | FR-NOTIF-003 |
| SCR-17 | États système | Hors ligne, indisponible, maintenance, erreur | FLOW-12 | — |

## 11. Écrans du back-office

Base : thème clair PrimeVue du socle, adapté aux jetons ci-dessus (accent bissap foncé). Tableaux denses, filtres persistants, actions sensibles avec confirmation et motif.

| ID | Écran | Périmètre | Exigences |
|---|---|---|---|
| BO-01 | Connexion (OTP e-mail, MFA TOTP pour rôles plateforme) | Tous | NFR-SEC-002 |
| BO-02 | Tableau de bord (vues, MAU, conversion, revenus, paiements en attente) | Plateforme / marque | FR-ADM-008 |
| BO-03 | Liste des séries (statut, licence, nb épisodes, marques qui la diffusent) | Plateforme | FR-ADM-001 |
| BO-04 | Édition série (onglets : Infos FR/EN, Médias, Épisodes, Licence, Diffusion) | Plateforme | FR-ADM-001 |
| BO-05 | Épisode & média (téléversement avec progression, statut d'encodage, sous-titres, aperçu) | Plateforme | FR-ADM-002, 003 |
| BO-06 | Licences (ayant droit, territoires, dates, sous-licence, alertes d'expiration à 30 j) | Plateforme | FR-ADM-004 |
| BO-07 | Utilisateurs / membres (recherche, fiche, ajustement de crédits) | Plateforme / marque | FR-ADM-006 |
| BO-08 | Commandes & paiements (filtres statut/fournisseur/pays, détail avec chronologie des événements, remboursement) | Plateforme / marque (lecture) | FR-ADM-007, FR-PAY-009 |
| BO-09 | Rapprochement (écarts, revue manuelle) | Plateforme | FR-PAY-010 |
| BO-10 | Vitrine (rangées, ordre, bannières, aperçu mobile) | Marque | FR-CAT-001 |
| BO-11 | Catalogue & prix de la marque (séries sélectionnables, épisodes gratuits, prix, packs par devise) | Marque | FR-TEN-005, FR-MON-001, 005 |
| BO-12 | Marques (liste, statut, création) | Plateforme | FR-TEN-001 |
| BO-13 | Configuration marque (identité, domaines, branding avec aperçu en direct et contrôle de contraste, pays/langues/devises, moyens de paiement, reversement) | Plateforme / marque (partiel) | FR-TEN-002..004 |
| BO-14 | Équipe & rôles | Marque / plateforme | FR-TEN-006 |
| BO-15 | Journal d'audit | Plateforme / marque | NFR-SEC-005 |
| BO-16 | Comptes fournisseurs de paiement (statut, pays, devises, test de connexion ; secrets jamais réaffichés) | Plateforme | FR-PAY-005 |
| BO-17 | Imports du catalogue (dépôt du manifeste, validation ligne par ligne, avancement par épisode, relance des échecs) | Plateforme | FR-ADM-009 |

## 12. Règles de cohérence entre écrans

1. Un prix en crédits s'écrit toujours « icône pièce + nombre », en safran.
2. Un montant monétaire s'écrit toujours avec la devise, selon la locale (`2 000 FCFA`, `D 150.00`).
3. Un épisode a toujours l'un de ces trois badges : **Gratuit**, **✓ Débloqué**, **🪙 15**.
4. Les statuts de paiement ont un vocabulaire unique : *En cours*, *Confirmé*, *Échoué*, *Annulé*, *Expiré*, *Remboursé* — identique dans l'app, les notifications, les reçus et le back-office.
5. Toute action destructive ou financière du back-office demande un motif et apparaît dans BO-15.
6. Les textes viennent des fichiers i18n (FR/EN) ; aucun texte en dur dans les composants.
7. Le branding de marque ne s'applique qu'aux jetons autorisés (§2.1) ; la structure reste identique d'une marque à l'autre.
