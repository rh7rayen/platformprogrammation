# Revue de sécurité et maintenance — 10 septembre 2026

Cette revue porte sur le code et les essais locaux de cette livraison. Ce n’est ni une certification de sécurité, ni un pentest de l’infrastructure cloud. Les essais fournisseur utilisent des doubles HTTP/Storage annoncés comme tels ; aucun programme PHP/Java n’a été exécuté sur une infrastructure distante et aucune vidéo ou invitation réelle n’a été transférée pendant cette revue.

## Corrections effectuées et preuves

| Constat vérifié | Correction | Vérification |
| --- | --- | --- |
| Monaco 0.56.0 inclut DOMPurify 3.4.8, à la fois dans ses dépendances, ses sources embarquées et son bundle AMD. Un override npm seul laisse le bundle vulnérable servi. | DOMPurify 3.4.15 exact, déduplication, reconstruction Monaco depuis ESM avec résolution explicite de l’import embarqué vers le paquet corrigé. Suppression uniquement de l’ancien répertoire généré `frontend/public/monaco/vs`. | `npm ls dompurify`, `npm audit`, garde de graphe esbuild, manifeste SHA256, `node scripts/verify-monaco.mjs`. |
| Le BFF lisait tout `request.text()` avant de vérifier 64 Kio : un corps chunked pouvait déjà occuper la mémoire. | Comptage des octets pendant lecture, rejet anticipé de Content-Length excessif, annulation du flux, délai global de réception 10 s, UTF-8 invalide refusé. | Tests corps chunked excessif, taille déclarée, caractère coupé entre segments et flux inachevé dans `backend/test/security-boundaries.test.ts`. |
| Une réponse d’authentification amont inattendue pouvait créer un cookie incohérent ; `fetch` pouvait suivre une redirection amont. | Validation du token et de l’expiration, redirections refusées, réponses sans cache. Cookie HttpOnly et SameSite strict maintenus ; Secure et préfixe __Host en production. | Tests session absente du JSON, cookie HttpOnly, rejet de réponse invalide et mutation d’une origine étrangère. |
| La vérification de session Supabase n’avait pas de timeout explicite. | Timeout 8 s et redirections refusées pour le SDK Auth. Chaque appel conserve un client isolé pour éviter le partage d’une session mutable entre utilisateurs. | Typecheck et suite API. Une panne Auth distante réelle reste à injecter en recette. |
| Le contrôle de ports du lanceur ne couvre pas deux API lancées séparément ou sur deux ports avec un même répertoire PGlite. | Verrou de fichier atomique `wx`, chemin réel canonique, propriétaire aléatoire, libération après fermeture/flush, fermeture idempotente. | Tests exclusion d’un second propriétaire, réouverture après libération et refus de supprimer un verrou dont le propriétaire a changé. Aucune base `.data` existante n’a été ouverte ou réparée pour ces tests. |
| Cinq emails séquentiels avec timeout 15 s pouvaient dépasser le bail de 60 s et être repris par un autre worker. | Lot de cinq envois parallèles, clé d’idempotence fournisseur, durée de chaque appel limitée. | Typecheck ; tests de contrat InvitationService avec fetch simulé, sans envoi externe. |
| L’IP commune du BFF pouvait faire partager un quota de sauvegarde à tous les étudiants. | Quota d’écriture après authentification, par identité ; quota de connexion après validation du corps, par compte normalisé. | Deux étudiants peuvent chacun effectuer 120 passages du garde avec la même IP ; un nouveau token du même compte ne contourne pas le quota. Trente connexions d’un compte ne bloquent pas un autre compte. |

Les alertes DOMPurify ne prouvent pas qu’un scénario UniExam exploitait toutes les configurations concernées ; elles justifient de retirer la version vulnérable. L’[avis officiel GHSA-55q2-fjhq-7xh7](https://github.com/cure53/DOMPurify/security/advisories/GHSA-55q2-fjhq-7xh7) affecte les versions jusqu’à 3.4.12 incluses et annonce 3.4.13 comme premier correctif pour ce cas. Le dépôt utilise 3.4.15, vérifié sur le registre npm, avec les autres corrections disponibles.

Le navigateur de vérification charge les fichiers générés depuis un serveur loopback temporaire, saisit `print(42)`, vérifie Python/PHP/Java/Web et d’autres grammaires, puis demande au worker JavaScript de diagnostiquer une vraie erreur de syntaxe. Résultat local : 91 langages enregistrés, deux workers locaux chargés, diagnostic reçu, aucune erreur navigateur. Les grammaires d’édition ne sont pas 91 compilateurs. L’application conserve ses tests de parcours complets séparés.

Le script de préparation refuse un DOMPurify différent de la version revue et un graphe réintroduisant la source embarquée. Lors d’une mise à jour, changer explicitement les versions revues dans le script et la vérification, puis reconstruire et relancer les essais. Un simple `npm audit` ne vérifie pas le contenu des assets statiques ou d’un CDN déjà publié. Invalider également ces assets lors d’un futur déploiement.

## Frontières examinées

**Copies et identité.** La session serveur est vérifiée avant les accès métier. La RLS et les clés composites portent le périmètre universitaire. Les solutions attendues vivent dans un schéma privé ; les réponses sont figées à la remise. Un enseignant affecté peut consulter/corriger ; le rôle administrateur n’est pas, à lui seul, un droit de lecture des copies ou vidéos. Les délais et versions sont contrôlés côté serveur. Les tests API couvrent accès d’un autre étudiant/établissement, réponses après remise, expiration, relecture et résultats avant publication.

**Exécution.** Aucun shell, eval ou processus étudiant ne s’exécute dans NestJS. L’adaptateur n’accepte qu’un runtime fixé dans la question et la dernière version enregistrée. Configuration HTTPS/authentifiée, catalogue vérifié, absence de fournisseur public de repli, paramètres réseau désactivés et sorties limitées. Les sources et entrées de la file sont effacées après transfert ou échec ; les copies académiques restent distinctes. Les quotas individuels ne constituent pas un plafond de coût global. L’isolation effective de l’hôte Judge0 et son réseau doit être auditée et testée sur l’infrastructure déployée : une réponse `/config_info` et un numéro de version ne suffisent pas.

**Vidéo.** Le navigateur demande un consentement et la surface à partager. L’API autorise la tentative avant de contacter Storage. Le bucket doit être privé, limité à 4 Mio/fichier et aux formats vidéo retenus. Les réservations sont ordonnées, idempotentes et limitées ; la taille et le MIME réels sont revérifiés à confirmation. La lecture est réservée à l’enseignant affecté via un lien de 120 s. Aucun octet vidéo ne traverse PostgreSQL. La capture, les interruptions et un navigateur modifié ne constituent pas une preuve d’absence ou de présence de fraude.

**Emails.** La cible doit être un destinataire actif de l’examen. Le contenu de la file incluant le code personnel est chiffré avec AES-256-GCM ; les codes de connexion sont hachés dans la table d’accès. Le contenu de mail est effacé après envoi ou expiration. `SENT` signifie accepté par le fournisseur, sans preuve de réception ou lecture. La clé de chiffrement et la clé Resend restent serveur et doivent être gérées hors dépôt. La migration 007 permet une réémission explicite après FAILED/EXPIRED, sans tentative commencée, avant fermeture et au plus trois fois sur 24 h. Elle crée un nouveau code/job, conserve l’historique et empêche un acquittement tardif de modifier le remplacement. Les tests de contrat couvrent ces courses ; la réception réelle reste à vérifier.

**Similarité et IA.** Une comparaison lexicale de copies peut aider un enseignant à vérifier un cas ; ce n’est pas une identification de l’auteur ou un taux fiable d’utilisation d’IA. Les extraits restent dans le périmètre de l’examen. Aucun score ni sanction automatique ne doit découler de ce signal seul. Le calcul interactif borné doit être déplacé vers un worker avec budget et timeout avant une montée en charge importante.

## Risques restant avant production

| Priorité | Travail restant |
| --- | --- |
| Haute | Recette réelle Supabase Auth/PostgreSQL/Storage avec deux établissements ; compte de service au moindre privilège et séparation du rôle de migration. La connexion privilégiée actuelle a plus de droits qu’un simple rôle de requêtes utilisateur. |
| Haute | Déploiement et audit du runner sur machines dédiées, sans secrets métier ni socket Docker partagé ; limites globales CPU/RAM/disque, réseau sortant effectivement bloqué, purge fournisseur et correctifs réguliers. |
| Haute | Admission partagée en périphérie, quotas globaux et par établissement, protection contre les rafales de login/sauvegarde/compilation. Les limites mémoire de cette livraison ne sont pas distribuées entre réplicas. |
| Haute | TLS/public origin, CSP compatible avec Next/Monaco/aperçu Web, protections de l’iframe, contrôle de la topologie proxy. Le blocage visuel de copier-coller est contournable et ne garantit jamais l’intégrité d’un examen. |
| Haute | Sauvegardes PostgreSQL/objets et exercice de restauration avec RPO/RTO convenus, métriques, alertes et gestion d’incident. |
| Moyenne | MFA/SSO, récupération des comptes, renouvellement de session adapté aux examens longs et procédure si la session expire pendant une tentative. |
| Moyenne | Gestion de rétention réellement planifiée : purge des objets vidéo, métadonnées, anciens jobs et audit. Le CLI de purge existe mais n’est pas un ordonnanceur cloud déployé. |
| Moyenne | Audit indépendant d’accessibilité, aménagements d’examen, transparence de la surveillance et gouvernance d’accès aux vidéos. |

Ces points décrivent des travaux d’exploitation concrets. Aucun fournisseur cloud, domaine, facture ou compte de production n’a été créé par cette revue.

## Maintenance livrée

Le workflow `.github/workflows/quality.yml` prépare les types Next, vérifie les types et l’audit npm, lance les tests API, reconstruit et vérifie Monaco dans Chrome, construit la production puis lance les parcours navigateur. Les actions officielles sont épinglées sur les commits des versions vérifiées [checkout 7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) et [setup-node 7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0), avec permissions en lecture et sans conserver les credentials Git. Ce fichier n’a pas été exécuté sur GitHub dans cette session.

Dependabot est configuré pour proposer des mises à jour hebdomadaires de npm et des actions ; aucune fusion automatique n’est configurée. Son activation effective nécessite que ce dépôt soit hébergé sur GitHub avec la fonctionnalité disponible. Ces fichiers ne publient pas l’application et ne créent aucun déploiement.

Après une fermeture normale du serveur local, le verrou PGlite disparaît. Après un arrêt forcé, **ne pas relancer plusieurs API et ne pas effacer la base** : vérifier le PID inscrit dans `.uniexam-process.lock`, confirmer que plus aucun processus n’utilise ce répertoire, conserver une copie de récupération si nécessaire, puis retirer uniquement le verrou abandonné. Le programme refuse volontairement de deviner qu’un verrou est obsolète. Ce verrou protège les processus qui utilisent le nouveau code ; arrêter l’ancienne version avant la première bascule.
