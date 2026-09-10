# Activer Supabase, les emails, le runner et la vidéo

Le code des intégrations est livré, mais aucun cloud, domaine, achat ou secret de production n’a été créé. Ces étapes décrivent une recette opérateur sur des services que l’établissement fournit. Les interrupteurs restent désactivés par défaut dans `.env.example` et les interfaces indiquent les fonctions indisponibles.

## 1. Base et identité Supabase

Créer ou sélectionner un projet de préproduction dédié. Le backend utilise les transactions PostgreSQL et `SET LOCAL ROLE uniexam_api` : choisir une URL de connexion compatible et une politique de pooling mesurée, avec TLS vérifié. Les modes de connexion sont décrits par [Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

Copier `.env.example` vers `.env` pour la recette locale connectée, ou injecter ces valeurs dans le gestionnaire de secrets de l’hébergement :

```dotenv
APP_MODE=supabase
NODE_ENV=production
WEB_ORIGIN=https://examens.votre-etablissement.example
DATABASE_URL=postgresql://CONNEXION_SERVEUR_A_RENSEIGNER
DATABASE_SSL=true
DATABASE_CA_FILE=
SUPABASE_URL=https://VOTRE-PROJET.supabase.co
SUPABASE_PUBLISHABLE_KEY=CLE_PUBLIQUE_DU_PROJET
```

Les valeurs en majuscules sont à remplacer, pas des clés fonctionnelles. `API_URL` appartient au serveur Next : adresse privée du Nest associé, par exemple `http://api:4000` dans le compose. Le navigateur utilise seulement l’origine publique Next. Garder l’API interne, exposer HTTPS via un proxy maîtrisé et contrôler le `Host`/protocole transmis pour la validation d’origine.

Appliquer `npm run db:migrate` avec la connexion opérateur. Elle applique les migrations 001 à 008 et leur journal transactionnel ; la migration 007 ajoute l’historique et les protections de réémission email. En production, le démarrage normal ne remplace pas cette opération. Le login du backend doit pouvoir prendre `uniexam_api`, sans attribuer ce rôle à `anon` ou `authenticated`. Finaliser les privilèges de ses tâches de confiance avant production.

Désactiver l’inscription libre si le déploiement utilise des comptes administrés. Provisionner le premier administrateur selon [DEPLOYMENT.md](DEPLOYMENT.md), puis préparer les profils, adhésions, rôles, inscriptions et affectations nécessaires. **L’invitation à un devoir ne provisionne pas un utilisateur Supabase.** Tester deux établissements et une révocation réelle avant d’accueillir des étudiants.

## 2. Invitations email Resend

Ajouter et vérifier un domaine expéditeur appartenant à l’établissement dans Resend, avec les enregistrements DNS indiqués par le fournisseur. La validation de domaine est un prérequis documenté par [Resend](https://resend.com/docs/dashboard/domains/introduction).

Créer une clé d’envoi et une clé de chiffrement **aléatoire de 32 octets encodés en base64** dans le gestionnaire de secrets. Ne pas utiliser un mot de passe humain comme clé AES. Injecter uniquement côté Nest :

```dotenv
EMAIL_ENABLED=true
RESEND_API_KEY=CLE_RESEND_SERVEUR
EMAIL_FROM=examens@votre-domaine-verifie.example
EMAIL_ENCRYPTION_KEY=CLE_ALEATOIRE_32_OCTETS_EN_BASE64
WEB_ORIGIN=https://examens.votre-etablissement.example
```

Le service exige un domaine public HTTPS dans `WEB_ORIGIN`, une adresse expéditeur sans retour à la ligne, la clé Resend et une clé AES de la bonne longueur. `.env.example` contient déjà les noms de variables. Aucune variable `NEXT_PUBLIC_*` n’est nécessaire. Redémarrer gracieusement Nest après configuration.

Pour la recette, utiliser un enseignant affecté et une vraie adresse de test **déjà associée à un étudiant actif inscrit**. Publier un examen encore ouvert, ouvrir **Inviter les étudiants**, sélectionner cette adresse puis demander l’envoi. Cette action remplace le code initial par un code personnel neuf, place le message chiffré en file et transmet ensuite au fournisseur. Vérifier le mail reçu et l’ouverture avec le bon compte ; essayer le même code avec un autre compte pour confirmer le refus.

| État | Sens dans UniExam |
| --- | --- |
| QUEUED | Message durablement placé en file ; pas encore accepté par le fournisseur. |
| SENDING | Worker en cours de tentative d’envoi. |
| SENT | Fournisseur ayant retourné un identifiant d’acceptation. Ne prouve ni réception en boîte ni lecture. |
| FAILED | Échecs répétés ; nouvelle demande explicite possible si les conditions restent valides. |
| EXPIRED | Fenêtre d’envoi dépassée ou examen fermé. |

L’intégration utilise l’[API d’envoi Resend](https://resend.com/docs/api-reference/emails/send-email) avec une clé d’idempotence par job. Les essais automatiques ne remplacent pas la recette du domaine et de sa délivrabilité. Les webhooks de bounce/lecture ne sont pas intégrés à ce lot.

La file tente jusqu’à cinq envois avec délai de reprise ; les messages non terminés expirent après douze heures ou à la fermeture de l’examen. Leur contenu chiffré est effacé après acceptation, échec final ou expiration. Les métadonnées d’historique restent conservées.

**Réessayer** après FAILED/EXPIRED crée un nouveau job et un nouveau code, conserve l’historique et change la clé d’idempotence. Cela exige une demande explicite, aucun début de tentative, un étudiant actif et un devoir encore ouvert. Maximum : trois réémissions par destinataire en 24 heures. Les jobs en cours ou SENT ne sont pas remplacés. Les acquittements tardifs d’un ancien claim ne peuvent pas écraser l’état de son remplacement.

Garder `EMAIL_ENCRYPTION_KEY` stable tant que des messages chiffrés restent en attente. Une rotation sans gestion de l’ancienne clé rendrait ces messages indéchiffrables. La rotation opérationnelle nécessite vidage/traitement de la file avec l’ancienne clé puis bascule, ou une évolution explicitement versionnée des clés. Ne jamais journaliser code personnel, corps déchiffré ou secrets.

## 3. Compilateurs Docker ou Judge0 privé

Déployer le runner sur des machines Linux **séparées** de Next/Nest/Supabase et de leurs secrets. Le daemon Docker livré dans `infrastructure/local-runner` s’utilise derrière un proxy HTTPS privé ; préparer les images avec le bootstrap puis lancer la matrice réelle de vérification sur l’hôte cible. Le poste Windows utilise Docker Desktop pour les essais locaux. Suivre [RUNNERS.md](RUNNERS.md) pour les commandes, l’isolation et les budgets. Supabase et l’hébergement Next ne fournissent pas à eux seuls les compilateurs.

Avec le daemon Docker :

```dotenv
RUNNER_ENABLED=true
RUNNER_PROVIDER=docker
RUNNER_BASE_URL=https://runner.votre-reseau-prive.example
RUNNER_AUTH_TOKEN=SECRET_ALEATOIRE_PARTAGE_NEST_RUNNER
```

Le secret n’appartient jamais au navigateur. Le daemon écoute sur `127.0.0.1:4200` derrière le proxy et reçoit seulement son propre secret, sans clés Supabase, email ou sessions. Il réserve deux exécutions simultanées : ce réglage local n’est pas un dimensionnement institutionnel. HTTPS, filtrage réseau, service supervisé, disque limité, mises à jour d’images et recette de reprise sont à déployer avant mise en service.

L’autre fournisseur pris en charge est Judge0 auto-hébergé :

```dotenv
RUNNER_ENABLED=true
RUNNER_PROVIDER=judge0
RUNNER_BASE_URL=https://runner.votre-reseau-prive.example
RUNNER_AUTH_TOKEN=SECRET_AUTHENTIFICATION_RUNNER
RUNNER_LANGUAGE_IDS={"python":71,"php":68,"java":62}
```

Les IDs sont des exemples à remplacer par ceux de **votre** endpoint `/languages`. Le serveur vérifie leurs noms, `/about` et les paramètres réseau de `/config_info`, puis expose les profils disponibles dans le catalogue. Aucun fournisseur public de repli n’est utilisé. Les autres langages ne deviennent exécutables que si leur mapping et leur disponibilité sont validés.

Tester chaque langage activé : programme correct, erreur de compilation, exception, boucle infinie, dépassement mémoire, accès réseau refusé, sortie trop volumineuse et panne du runner. Observer le programme réel, son résultat et les métriques d’isolation avant d’annoncer une prise en charge opérationnelle. SQL utilise SQLite éphémère avec Docker ; avec Judge0, il exige un mapping SQL vérifié. Le Web à trois fichiers peut être essayé sans ce service.

## 4. Vidéo dans Storage privé

Créer un bucket Supabase **privé**, limité à 4 Mio par objet et à `video/webm` et/ou `video/mp4`. Les restrictions du bucket sont distinctes des autorisations temporaires générées par le backend ; consulter les [fondamentaux Supabase Storage](https://supabase.com/docs/guides/storage/buckets/fundamentals). Ne pas ajouter de politique de lecture publique.

```dotenv
RECORDINGS_ENABLED=true
SUPABASE_URL=https://VOTRE-PROJET.supabase.co
SUPABASE_SERVICE_ROLE_KEY=CLE_SERVICE_ROLE_SERVEUR
RECORDINGS_BUCKET=exam-recordings
RECORDINGS_RETENTION_DAYS=30
```

Le bucket doit avoir `file_size_limit` ≤ `4194304` et une liste MIME explicite. Le backend refuse un bucket public ou sans plafond. La clé service-role reste serveur. Les vidéos voyagent directement du navigateur vers Storage, la base ne reçoit que les métadonnées.

Tester avec une surface de test volontaire : demande de consentement et choix navigateur, capture, confirmation de segments, arrêt, lecture par l’enseignant affecté et refus pour un administrateur seul/un autre étudiant. Tester aussi une coupure réseau, la remise pendant un segment et une URL expirée. Ne pas automatiser une capture du véritable écran d’un utilisateur. Voir [VIDEO_STORAGE.md](VIDEO_STORAGE.md) pour les clips autonomes, les baux, les quotas et les limites des navigateurs.

Déployer réellement la purge et l’alerte associée : le CLI `backend/src/monitoring/purge-recordings.ts` traite jusqu’à cent objets par appel. Une planification d’infrastructure reste nécessaire ; afficher « 30 jours » ne signifie pas que le worker est déjà planifié. Ne pas lancer une deuxième API PGlite sur le même répertoire pour la maintenance locale.

## 5. Assistant IA et mise en service

L’assistant de préparation pédagogique est indépendant des captures et de la similarité locale. Si nécessaire, activer `AI_ENABLED`, `OPENAI_API_KEY`, `OPENAI_MODEL` et `AI_DAILY_LIMIT` selon [DEPLOYMENT.md](DEPLOYMENT.md). Aucun détecteur d’IA fiable ou sanction automatique n’est fourni.

Finir la recette avec TLS, cookies, CSP, isolation des établissements, reprise après panne, sauvegarde/restauration et limites de facturation par établissement. Vérifier un parcours complet enseignant → invitation → étudiant → code/aperçu → sauvegarde → remise → correction. La réussite locale ne valide ni le cloud ni une population de cent millions de connexions ; [CAPACITY_PLAN.md](CAPACITY_PLAN.md) définit les mesures et paliers nécessaires.
