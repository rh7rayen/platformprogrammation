# Exécution des programmes

Le catalogue offre Python, PHP, Java, JavaScript, TypeScript, C, C++, C#, Go, Rust, Ruby, Bash et SQL sur SQLite éphémère. La base métier n’est jamais utilisée pour les requêtes SQL des étudiants. Un projet Web contient exclusivement `index.html`, `style.css` et `script.js` pour un aperçu dans le navigateur. Les autres langages utilisent un runner Docker séparé ou un service Judge0 auto-hébergé. Aucun code étudiant ne passe par `eval`, un sous-processus ou le shell de NestJS.

## État vérifié

Les tests `backend/test/docker-adapter.test.ts` et `backend/test/execution.test.ts` utilisent des serveurs HTTP de contrat explicitement nommés comme tels. Ils vérifient les protocoles Docker/Judge0, les bornes et les permissions sans compiler de PHP ou de Java. L’exécution d’un langage n’est activée qu’après validation du service et disponibilité de son runtime. La recette sur le véritable moteur Docker doit être relevée séparément des tests de contrat.

## Runner Docker distinct

Configurer NestJS avec `RUNNER_PROVIDER=docker`, `RUNNER_ENABLED=true`, `RUNNER_BASE_URL=http://127.0.0.1:4200` et un `RUNNER_AUTH_TOKEN` aléatoire d’au moins 16 caractères. Cette URL HTTP est réservée au loopback de développement ; HTTPS est requis pour un hôte distant ou la production. Le daemon est un service séparé dans `infrastructure/local-runner`. NestJS communique exclusivement par HTTP : il ne reçoit aucun accès au socket Docker, image, commande shell ou argument Docker contrôlé par un candidat.

Le protocole 1 exige `/health` avec `engine=uniexam-docker`, `network_disabled=true` et `privileged=false`. `/runtimes` fournit les identifiants, versions, images et disponibilités validées du daemon ; seules les entrées connues et disponibles sont activées. Les vérifications sont mises en cache 15 secondes. `/runs` reçoit uniquement `{runtime,source,stdin}` et renvoie un UUID ; `/runs/:id` renvoie le résultat borné. Il n’existe aucun repli vers un service public. Les statuts d’attente Docker sont consultés dans la même file persistante que Judge0.

SQL utilise un environnement SQLite temporaire à chaque exécution. Aucune connexion, clé Supabase ou copie de la base pédagogique n’est transmise au conteneur.

### Utiliser l’installation Docker locale

Docker Desktop doit fonctionner en mode Linux. Sur ce poste, le `.env` privé connecte déjà Nest au runner local ; son token n’est pas affiché et ne doit pas être copié dans le navigateur.

```sh
# Préparer et vérifier les images, lors de l’installation ou d’une mise à jour :
npm run runner:setup
# Service d’exécution, premier terminal :
npm run runner:start
# Application, second terminal :
npm run dev
# Matrice réelle des 13 programmes console et sondes d’isolation :
npm run runner:verify
# Parcours réels via l’éditeur, dans une base de test en mémoire :
npm run test:runner:live
```

Le lanceur du runner ne transmet à son enfant que les variables système nécessaires, le chemin Docker et son propre token. Les clés de base, d’email et de sessions de l’application ne sont pas héritées. **Ctrl+C** ferme le service après nettoyage des conteneurs et sources. Si Docker s’arrête, les nouvelles exécutions sont refusées et les copies sauvegardées restent conservées.

Le moteur réserve deux conteneurs standards au maximum, ou un MySQL exclusif. Le profil standard limite chaque conteneur à 768 Mio et son `/tmp` à 128 Mio ; MySQL utilise 1 Gio et 512 Mio. Le réseau est désactivé, la racine et la source sont en lecture seule, les capabilities sont retirées et `no-new-privileges` est imposé. Les options effectives sont inspectées avant le programme. Le manifeste local contient uniquement des images ayant passé une exécution réelle.

React, Angular, Symfony et Laravel utilisent des projets à deux fichiers et des aperçus temporaires distincts des sorties texte. MySQL utilise son vrai moteur, distinct de SQLite. Oracle PL/SQL est proposé pour l’édition mais n’est pas déclaré exécutable sans validation de son moteur. Les exemples, bornes et différences entre aperçu interactif et réponse HTTP sont détaillés dans [FRAMEWORKS.md](FRAMEWORKS.md).

## Déploiement du runner

Déployer Judge0 sur des machines Linux dédiées, séparées du réseau de la base métier et des secrets de l’application. La procédure officielle utilise des conteneurs privilégiés : ils ne doivent pas partager les hôtes Next.js, NestJS, Supabase, les volumes de production ou un socket Docker avec eux. La version officielle 1.13.1 corrige trois vulnérabilités critiques des versions précédentes ; choisir une version auditée et à jour, avec ses images épinglées par digest et ses dépendances revues avant chaque déploiement. La vérification de version effectuée par UniExam n’est pas un audit de l’hôte. [Publication officielle et prérequis Linux](https://github.com/judge0/judge0/releases/tag/v1.13.1), [configuration des conteneurs officielle](https://github.com/judge0/judge0/blob/v1.13.1/docker-compose.yml).

Le fichier `infrastructure/runner/judge0.conf.example` fournit un ensemble de réglages à fusionner avec la configuration officielle. Appliquer aussi un filtrage réseau côté infrastructure : entrée HTTPS uniquement depuis les workers autorisés, blocage des connexions sortantes des environnements étudiants, stockage éphémère avec quota, capacité CPU/mémoire réservée. Garder Redis et la base propre à Judge0 dans son réseau privé. Les vidéos ne vont jamais dans ce service.

Les options réseau et les plafonds de Judge0 doivent être fixés côté fournisseur. L’adaptateur transmet des limites CPU, mémoire, durée, threads et fichiers pour chaque exécution ; les réponses acceptées par UniExam sont plafonnées à 32 Kio par flux. La taille de fichier de 16 Mio permet les artefacts compilés ; le stockage du runner nécessite en plus un quota global, une purge de ses soumissions et une surveillance de son espace disque. [Options officielles](https://github.com/judge0/judge0/blob/v1.13.1/judge0.conf).

Dans l’environnement de NestJS :

```dotenv
RUNNER_ENABLED=true
RUNNER_PROVIDER=judge0
RUNNER_BASE_URL=https://runner.example.internal
RUNNER_AUTH_TOKEN=<secret injecté par votre gestionnaire de secrets>
RUNNER_LANGUAGE_IDS={"python":71,"php":68,"java":62}
```

Les nombres de cet exemple ne constituent pas un catalogue garanti : les relever dans `/languages` de **votre instance**. UniExam vérifie chaque ID avec le nom du langage et n’active que les correspondances valides. Ajouter les autres langages au JSON après vérification et test d’un programme réel. HTTP n’est accepté qu’en développement sur loopback ; HTTPS est requis ailleurs. Les serveurs de démonstration publics connus sont refusés et aucun fournisseur de repli n’est utilisé.

La disponibilité vérifie `/about` (version au moins 1.13.1), `/config_info` (`enable_network=false` et `allow_enable_network=false`) et `/languages`. Un résultat négatif désactive l’exécution et reste visible dans le catalogue. Ces vérifications sont mises en cache pendant 15 secondes. Le token fournisseur reste exclusivement côté serveur.

## API et stockage

| Route sous `/api/v1/universities/:universityId` | Utilisation |
| --- | --- |
| `GET /execution/runtimes` | Catalogue et disponibilité vérifiée par langage. |
| `POST /attempts/:id/questions/:questionId/runs` | `{ "expected_version": 2, "stdin": "" }`, retourne une tâche `QUEUED`. |
| `GET /attempts/:id/runs/:runId` | Statut, sortie standard, erreurs, sortie du compilateur, temps et mémoire. |

La version demandée doit être la dernière version enregistrée. Le client n’envoie ni source arbitraire à cette route, ni commande de compilation, ni URL de rappel. L’enseignant fixe le langage dans la question ; un étudiant ne peut pas le changer. Une tentative terminée ne peut plus lancer de programme.

Le serveur place le code enregistré dans une file PostgreSQL privée. Un worker réclame des tâches avec un verrou de ligne et appelle Judge0 en mode asynchrone, puis consulte son état. Ce mode suit l’API documentée ; `wait=true` est déconseillé par Judge0 pour la montée en charge. [Documentation de l’API](https://ce.judge0.com/).

Une tentative a au maximum une exécution active. Chaque étudiant dispose de 6 départs par minute et 200 par jour, avec verrou partagé en base pour empêcher les courses entre instances. Le code/projet est limité à 30 000 octets UTF-8 et l’entrée à 4 000 octets. Les sorties ont 32 Kio maximum par flux ; une réponse trop volumineuse fait échouer la tâche sans remplir la base.

Le code et l’entrée de la file sont effacés après acceptation par le runner, ou en cas d’échec. La copie académique reste conservée dans la réponse au devoir. Les résultats d’exécution sont supprimés de cette file après 7 jours, indépendamment de la rétention des copies. Configurer également la rétention propre au fournisseur : l’effacement de la file UniExam n’efface pas automatiquement la base Judge0.

Un départ dont l’acquittement est ambigu n’est jamais relancé automatiquement : cela pourrait exécuter deux fois le programme. L’attente locale, y compris derrière un MySQL exclusif, est limitée à 30 secondes avant tout démarrage de conteneur. Les tâches inachevées échouent après deux minutes, ou trois minutes pour MySQL afin de couvrir son initialisation ; l’étudiant peut demander une nouvelle exécution. Les programmes à plusieurs fichiers côté serveur, les dépendances téléchargées, les applications réseau persistantes et les tests unitaires privés de correction ne sont pas pris en charge par cet adaptateur. Le Web à trois fichiers dispose de son propre aperçu côté navigateur.

## Validation et capacité

Exécuter les tests de contrat avec `npm exec tsx -- --test --test-concurrency=1 backend/test/execution.test.ts`. Avant de déclarer un langage exécutable en production, tester sur le vrai runner : programme valide, erreur de compilation, boucle infinie, dépassement mémoire, tentative d’accès réseau, saturation et récupération après panne.

Cette intégration est un premier worker durable, avec des lots de quatre tâches et des réservations temporaires. Elle ne constitue pas une capacité démontrée de cent millions de connexions. Une infrastructure de grande taille nécessite admission globale à la périphérie, files partitionnées, workers dédiés, orchestration et autoscaling indépendants, budgets par établissement, métriques de profondeur/latence, tests de charge et plan de reprise. Les opérations de purge et d’expiration doivent devenir des tâches périodiques dédiées avant un déploiement à grande échelle.
