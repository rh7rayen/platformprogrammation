# UniExam — état du projet

Livraison locale du **10 septembre 2026 : devoirs multi-langages, atelier Web, invitations, capture privée et revue de similarité**. Next.js + NestJS + PostgreSQL/PGlite en démonstration ; Supabase, Resend et Judge0 distants restent à configurer et valider. Ce statut décrit ce qui est présent et testé, sans déclarer une plateforme institutionnelle complète ou une capacité cloud non mesurée.

## Périmètre

| Module | État | Preuve et limite |
| --- | --- | --- |
| Monorepo Next/Nest/TypeScript | IMPLEMENTED | Typecheck et build de production locaux réussis. |
| Structure universitaire, matières, classes, affectations et inscriptions | IMPLEMENTED | API/UI persistantes et contraintes de périmètre. |
| Sessions, révocation, suspension et RLS | IMPLEMENTED | Tests d’isolation ; quotas par acteur après authentification. |
| Édition/archives avancées de structure, provisionnement complet, MFA/reset/SSO/imports | PLANNED | Ne pas confondre avec les invitations à un devoir existant. |
| Supabase Auth/PostgreSQL distants | PARTIAL | Adaptateur et migrations ; recette fournisseur non effectuée. |
| Devoirs, barèmes, publication, codes et attribution | IMPLEMENTED | Questions de programmation, QCM et rédaction ; contenu publié immuable. |
| Minuteur, sauvegarde, remise et correction | IMPLEMENTED | Horloge serveur, version optimiste, expiration, QCM automatique et correction manuelle. |
| Catalogue et éditeur multi-langages | IMPLEMENTED | 20 langages/environnements, fichiers et modèles ; Monaco reconstruit avec dépendance corrigée. Mode agrandi, plein écran, taille du texte et console repliable. |
| Projet Web | IMPLEMENTED | `index.html`, `style.css`, `script.js` et aperçu interactif isolé. Pas de serveur Web pédagogique persistant ni dépendances réseau. |
| Exécution Docker locale | IMPLEMENTED | Docker Desktop Linux installé ; 13 runtimes console et leurs vrais programmes/erreurs/entrées/délais validés. File durable Nest séparée du daemon, images identifiées par SHA-256, conteneurs non privilégiés et réseau coupé. Production et forte charge non validées. |
| React, Angular, Symfony et Laravel | IMPLEMENTED | Vrais frameworks préinstallés, deux fichiers éditables chacun, compilation et aperçus temporaires privés. Angular AOT/React interactifs ; Symfony/Laravel testent une requête HTTP sans session par exécution. |
| SQLite et MySQL | IMPLEMENTED | Deux moteurs distincts ; bases neuves et isolées à chaque exécution. MySQL : DDL/DML/procédures et refus des privilèges administratifs validés. |
| Oracle PL/SQL | PARTIAL | Édition et remise ajoutées ; exécution indisponible. Inspection de l’image Free Lite : 3 401 098 568 octets de données à décompresser, au-delà des 2 Gio temporaires du prototype. Aucun relèvement des limites ni moteur Oracle annoncé fonctionnel. |
| Invitations email de devoir | PARTIAL | File Resend chiffrée, statuts et réémission après FAILED/EXPIRED avec migration 007. Désactivé localement ; aucun email réel envoyé. |
| Capture d’écran et consultation enseignant | PARTIAL | Composants et API, consentement, segments directs Storage, permissions/quotas/purge testés avec stockage simulé. Bucket réel non connecté. |
| Test de capture locale | IMPLEMENTED | Consentement, MediaRecorder réel, aperçu et téléchargement sur l’appareil. Arrêt à 60 s, blobs conservés limités à 8 Mio ; aucun transfert au serveur ni à l’enseignant. |
| Similarité locale | IMPLEMENTED | Comparaison lexicale entre copies autorisées, extraits et limites. Ne détecte pas l’auteur ou une probabilité d’IA ; aucune sanction automatique. |
| Assistant de QCM IA | PARTIAL | Schémas, quota, endpoint et UI ; fournisseur non configuré ni testé. |
| Presse-papiers | PARTIAL | Contrôle d’interface selon le devoir, contournable. |
| Sécurité et maintenance | PARTIAL | Correctifs BFF/PGlite/Monaco, CI et Dependabot fournis ; audit externe, exécution GitHub et exploitation cloud non validés. |
| Forte charge | PLANNED | Architecture et modèle budgétaire documentés ; aucune garantie de 100 millions de connexions. |

## Vérifications de cette livraison

- TypeScript et compilation Nest/Next vérifiés localement.
- **76 tests backend validés** en une suite complète : RLS, sauvegardes, quotas, protocole Docker/Judge0, invitations, vidéo et contrôles privés des aperçus. Ces tests utilisent des services fournisseurs simulés.
- Dix tests ciblés de sécurité validés : BFF borné, sessions, verrou PGlite et quotas indépendants pour deux étudiants derrière le même BFF.
- Vérification autonome de Monaco dans Chrome : saisie, intégrité des fichiers, 91 grammaires enregistrées, worker JavaScript local et diagnostic de syntaxe. Ce nombre de grammaires n’est pas un nombre de compilateurs connectés.
- `npm audit --audit-level=low` : aucune vulnérabilité signalée lors de la revue. Le bundle AMD contenant DOMPurify 3.4.8 a été remplacé par une construction ESM utilisant 3.4.15.
- **12 parcours navigateur ordinaires validés**, dans une API en mémoire sur 4100 et Next sur 3100. Saisie, agrandissement, plein écran, mobile, autosave, remise, permissions et vraie capture MediaRecorder sur canvas synthétique sont couverts.
- **51 scénarios de langages console réels réussis**. Le premier rapport `output/runner/console-13-real.json` contient aussi un échec de sonde réseau dû à une résolution DNS non bornée ; la sonde a été corrigée avec une adresse numérique. Les deux sondes réseau/fichier ont ensuite réussi : `output/runner/isolation-real.json`. Aucun résultat initial n’a été réécrit.
- React/Angular : compilation réelle et compteurs interactifs dans Chrome hors réseau, plus erreurs TypeScript/template. Symfony/Laravel : **20 tests réels réussis** sur l’image reconstruite depuis les deux composer.lock. MySQL : **10 scénarios réels réussis** et nettoyage entre chaque base.
- Parcours UI des quatre frameworks et de MySQL réussi : onglets éditables, code sauvegardé, exécution, aperçu privé, interactions React/Angular, GET/POST Symfony/Laravel et somme SQL égale à 42. Rapports : `test-results/runner-live/` et `playwright-report/runner-live/`.
- **Deux parcours Docker UI complets réussis en 9 minutes**, dont les treize langages console via le bouton Exécuter et une erreur PHP, plus le parcours frameworks/MySQL ci-dessus. Les pauses nécessaires respectent les quotas des étudiants. Aucun de ces devoirs de test n’est écrit dans la base de démonstration.
- Revue de la file : attente totale de 30 secondes, y compris derrière MySQL exclusif, avant création du conteneur ; expiration métier de trois minutes pour MySQL, deux pour les autres. Douze tests unitaires ciblés de file/arrêt/nettoyage passent. Les aperçus ont aussi quatre tests de rétention, accès, expiration et plafonds.
- Supabase distant, envoi email, capture/lecture cloud et charge ne sont pas validés. Aucun achat, compte cloud ou déploiement n’a été effectué. L’exécution Docker locale dispose de sa recette réelle séparée des tests de contrat.

## Démonstration

**Sami Haddad** enseigne PHP, Java et Web à **Ingénieur 1 · Développement logiciel**. **Lina Ben Salem** dispose de trois devoirs, ouverts par `DEMO-PHP`, `DEMO-JAVA` et `DEMO-WEB`. Les comptes précédents Yassine/Inès/Nour/Adam et le code `PYTHON-DEMO` sont conservés. L’entrée par défaut est Devoirs & examens.

Les compétences Codex locales `playwright`, `security-best-practices`, `security-threat-model` et `gh-fix-ci` ont été installées pour le travail de développement, test et revue. Elles ne fournissent pas une maintenance autonome déjà déployée dans le cloud.

## Incident historique conservé

L’ancienne `.data/uniexam` a échoué à la récupération PostgreSQL avec un journal/checkpoint invalide. La base et `.data/uniexam-backup-before-recovery` restent conservées ; aucune restauration de leurs données n’a été réussie.

La démo active de ce poste utilise `.data/uniexam-exams`, choisie dans `.env` ignoré par Git. Les données d’ingénierie s’ajoutent avec des identifiants fixes sans réinitialiser les anciennes tentatives, le code sauvegardé ou les dates. Le lanceur ferme PGlite par IPC et refuse les ports occupés ; un verrou de dossier interdit aussi deux API utilisant la même base locale. Après un arrêt forcé, ne retirer qu’un verrou dont le propriétaire est confirmé arrêté, conformément à `docs/SECURITY_REVIEW.md`.

## Limites et activation suivante

Une tentative par devoir ; pas d’aménagement individuel, de modification des questions publiées ou des résultats diffusés. Session de connexion limitée à une heure, même pour un devoir plus long : la reconnexion conserve l’échéance. Pas de sauvegarde hors ligne garantie. BFF : 64 Kio par demande, délai de lecture borné ; listes de devoirs limitées aux 100 derniers accessibles. Les limiteurs restent locaux à chaque instance et nécessitent une admission partagée en production.

La réémission email est explicite, seulement après FAILED/EXPIRED, avant début du devoir et avant fermeture, limitée à trois demandes sur 24 h par destinataire. Elle remplace le code et crée un nouveau job ; un email SENT n’est pas une preuve de réception. Une invitation ne crée pas un compte. Les vidéos restent dans l’onglet tant que le transfert n’est pas confirmé ; la purge cloud doit être réellement planifiée.

Suivre `docs/CLOUD_ACTIVATION.md` pour Supabase, les emails, le runner Docker/Judge0 et le stockage. Les usages et limites des projets sont dans `docs/FRAMEWORKS.md`. La charge et les coûts se dimensionnent dans `docs/CAPACITY_PLAN.md`. Les limites de sécurité et de recette figurent dans `docs/SECURITY_REVIEW.md`, `docs/RUNNERS.md` et `docs/VIDEO_STORAGE.md`.
