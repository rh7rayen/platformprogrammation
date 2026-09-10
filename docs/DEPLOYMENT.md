# Installation et exploitation

Pour les valeurs de configuration et la recette des intégrations, suivre aussi [CLOUD_ACTIVATION.md](CLOUD_ACTIVATION.md). Les devoirs multi-langages, l’aperçu Web, les files d’exécution/email et la capture privée sont implémentés ; leurs services cloud ne sont pas provisionnés par ce dépôt.

## Développement local

Installer Node.js 24.18.0, puis `npm ci` à la racine. Le lockfile fixe les dépendances transitives ; les dépendances directes sont exactes. `npm run dev` démarre Next.js et NestJS. Sans `.env`, le mode démo est choisi et clairement affiché. La migration et les données fictives sont initialisées automatiquement dans `.data/uniexam`.

La démonstration utilise le même SQL métier que la cible PostgreSQL, mais une frontière d’authentification locale spécifique. Elle ne valide pas Supabase Auth, TLS distant, Storage, PostgREST, Docker ou la performance PostgreSQL de production. Ne jamais partager le serveur de démonstration publiquement. Pour un nouvel état local, choisir un **nouveau** `DEMO_DATA_DIR` ; ne pas effacer des données utilisateur par automatisme.

Le lanceur refuse les ports occupés et ferme la base via IPC à l’arrêt. Le verrou `.uniexam-process.lock` interdit deux ouvertures de la même base persistante. Utiliser Ctrl+C puis attendre la fermeture. Un verrou laissé après crash exige une vérification opérateur ; la procédure est dans [SECURITY_REVIEW.md](SECURITY_REVIEW.md). Sur le poste de réalisation, `.data/uniexam-exams` reste la base de démo active ; l’ancienne `.data/uniexam` et sa sauvegarde sont conservées après l’échec historique de récupération du journal/checkpoint, sans restauration réussie.

## Projet Supabase

1. Créer ou utiliser un projet dédié, PostgreSQL 15+ (les unicités `NULLS NOT DISTINCT` l’exigent). Les examens sont disponibles après migrations, provisionnement des personnes et affectations nécessaires ; l’exécution distante, l’email et la vidéo ont chacun un interrupteur distinct.
2. Dans Supabase Auth, désactiver l’inscription libre. Configurer le domaine de l’application. Le bootstrap de ce lot crée explicitement un administrateur, sans envoyer d’email.
3. Copier `.env.example` vers `.env`. Choisir `APP_MODE=supabase`, renseigner `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`. Utiliser une connexion PostgreSQL compatible avec les transactions et le rôle applicatif. `DATABASE_SSL=true`, certificat d’autorité configurable par `DATABASE_CA_FILE`. Ne pas désactiver la vérification TLS à distance.
4. Appliquer `npm run db:migrate` avec une connexion opérateur autorisée à créer le rôle `uniexam_api`, les tables, fonctions et politiques. Les migrations 001 à 008 sont transactionnelles, enregistrées dans `private.schema_migrations` et verrouillées côté PostgreSQL. 007 ajoute l’historique des invitations ; 008 étend le catalogue des environnements.
5. La connexion serveur doit pouvoir `SET ROLE uniexam_api`. Si nécessaire, l’opérateur exécute `GRANT uniexam_api TO <login_backend>` avec un nom de rôle contrôlé. Le rôle `uniexam_api` est NOLOGIN ; ne jamais l’attribuer à `anon` ou `authenticated`. Le backend utilise aussi des opérations privilégiées bornées pour l’identité et le quota IA : concevoir le compte de service et les grants de ces opérations avant production. La première recette distante peut utiliser le compte opérateur sur un environnement de test ; ce n’est pas une validation de moindre privilège de production.
6. Provisionner le premier administrateur avec les variables d’environnement `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD` (16 caractères minimum), `BOOTSTRAP_NAME`, `BOOTSTRAP_UNIVERSITY`, `BOOTSTRAP_CODE`, `SUPABASE_SECRET_KEY`, puis `npm run db:bootstrap`. Ne pas passer de mot de passe dans la ligne de commande ou le dépôt. Effacer ces variables après usage. Le script refuse un code universitaire déjà présent ; en cas d’échec après création d’identité, il demande la suppression compensatoire du compte créé et signale un échec de compensation.
7. Démarrer et tester une connexion réelle, les rôles de deux universités et la révocation. Le rattachement UI exige des profils déjà provisionnés. L’interface complète d’invitation/création de comptes étudiants reste à construire. L’invitation email à un devoir est désormais fournie pour des destinataires déjà inscrits ; elle ne crée pas de compte.

Ne jamais copier la frontière `auth.users` de démonstration dans Supabase. Le fournisseur possède déjà son schéma `auth` et gère les mots de passe. Le backend ne stocke pas leur hash lui-même. Ne pas inscrire de clé secrète dans Next.js public, un runtime étudiant ou les logs.

## Assistant IA

Configurer `OPENAI_API_KEY` uniquement côté NestJS, `OPENAI_MODEL` (défaut de départ : `gpt-4.1-mini-2025-04-14`), `AI_ENABLED=true`, `AI_DAILY_LIMIT=20`. Le modèle doit être disponible pour le compte et compatible avec Responses/Structured Outputs. Les requêtes utilisent `store:false`, un timeout de 45 secondes et une sortie bornée. Vérifier les réglages contractuels et de conservation du fournisseur pour l’établissement ; ce paramètre seul ne promet pas une absence totale de rétention chez le fournisseur.

Les utilisateurs voient une indisponibilité explicite sans clé. Aucun appel externe n’a été exécuté pendant la livraison. Tester le comportement réel, les refus et le budget avec une clé fournie avant de déclarer l’intégration IMPLEMENTED. Aucun détecteur d’IA ne doit être présenté comme preuve de fraude.

## Conteneurs de l’application centrale

`docker-compose.yml` et `infrastructure/Dockerfile` construisent Next.js et NestJS avec une image Node épinglée. Le compose est prévu pour **Supabase externe** ; il ne prétend pas installer une pile Supabase locale avec une simple image PostgreSQL. Docker Desktop est installé sur le poste de réalisation pour le runner pédagogique. Cela ne valide pas le compose de production Next/Nest/Supabase : sa recette reste à effectuer.

```sh
docker compose build
docker compose up -d
```

Une `.env` Supabase fonctionnelle est nécessaire. Les migrations et le bootstrap sont des opérations opérateur explicites, pas des actions cachées au démarrage de production. Les containers sont non-root. Le seul port publiquement exposé par défaut est Next.js sur localhost ; mettre un reverse proxy HTTPS devant pour une recette distante. `WEB_ORIGIN` doit correspondre au domaine externe et le proxy doit transmettre correctement `Host`/protocole pour la validation d’origine. L’API reste sur le réseau interne.

Le compose ne déploie pas le runner pédagogique ni Supabase Storage ; leurs adaptateurs sont présents et leurs infrastructures restent externes. Ne jamais monter `/var/run/docker.sock` dans l’application centrale ou dans une sandbox. Les bases pédagogiques ne réutilisent jamais `DATABASE_URL`.

## Activer les intégrations

Les variables exactes sont déjà dans `.env.example`. [CLOUD_ACTIVATION.md](CLOUD_ACTIVATION.md) détaille chaque parcours et les contrôles de recette :

- **Exécution** : `RUNNER_PROVIDER=docker|judge0`, `RUNNER_ENABLED`, `RUNNER_BASE_URL`, `RUNNER_AUTH_TOKEN`, et `RUNNER_LANGUAGE_IDS` pour Judge0. Le daemon Docker livré écoute seulement sur le loopback : sur un hôte Linux dédié, le placer derrière un proxy HTTPS authentifié accessible uniquement par Nest. Préparer et vérifier les images sur cet hôte. Lire [RUNNERS.md](RUNNERS.md). L’hébergement du frontend seul ne fournit aucun compilateur.
- **Resend** : `EMAIL_ENABLED`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_ENCRYPTION_KEY` et `WEB_ORIGIN` HTTPS. Domaine vérifié, clé AES de 32 octets en base64, file chiffrée et envoi explicite par l’enseignant. Réémission FAILED/EXPIRED avant début du devoir, au plus trois sur 24 h.
- **Vidéo** : `RECORDINGS_ENABLED`, `SUPABASE_SERVICE_ROLE_KEY`, `RECORDINGS_BUCKET`, `RECORDINGS_RETENTION_DAYS` et `SUPABASE_URL`. Bucket privé limité à 4 Mio et MIME vidéo. Les octets vont directement au stockage ; les métadonnées restent dans PostgreSQL. Lire [VIDEO_STORAGE.md](VIDEO_STORAGE.md) et planifier réellement la purge.

Le Web à trois fichiers et la similarité lexicale locale ne nécessitent pas ces fournisseurs. La similarité ne fournit pas un détecteur fiable d’IA. Aucune facture, ressource cloud, invitation réelle ou vidéo de production n’a été créée pendant la livraison.

## Avant production — travail restant

- Recette réelle Supabase et durcissement du compte PostgreSQL de service ; vérification RLS distante après chaque migration.
- MFA obligatoire pour les rôles privilégiés, activation/invitation/récupération, rotation contrôlée des sessions, SSO et administration des révocations.
- HTTPS, politique CSP compatible Next.js avec nonce, en-têtes contrôlés au reverse proxy et audit des cookies.
- Admission et quotas partagés avec équité par université ; extraction des files PostgreSQL actuelles vers des workers dédiés avant une montée en charge importante, puis choix de files partitionnées selon les mesures.
- Sauvegarde PostgreSQL avec rétention, sauvegarde des buckets, test de restauration vers un projet isolé, objectifs RPO/RTO validés par l’établissement.
- Métriques et alertes : disponibilité API/base, latence, sessions, erreurs, quota IA, âge des files, capacité des sandboxes, volumes vidéo et retard de suppression.
- Chargement initial cible de 200 étudiants : objectif de test, pas capacité garantie. Séparer QCM, exécutions, builds et vidéo lors des mesures.
- Audit indépendant des sandboxes, autorisations vidéo, rétention, accessible keyboard/contrastes et aménagements.

Les healthchecks HTTP existent ; il n’y a pas encore de collecte Prometheus, de restauration automatisée ni d’alertes réellement déployées. Le frontend français est livré ; anglais/arabe et RTL restent PLANNED.

La CI de `.github/workflows/quality.yml` et Dependabot sont fournis mais non exécutés sur GitHub pendant cette session. Le modèle de coût et de débit `scripts/capacity-model.mjs` et [CAPACITY_PLAN.md](CAPACITY_PLAN.md) explicitent les hypothèses : une architecture ne garantit pas cent millions de connexions sans infrastructure provisionnée et essais représentatifs.
