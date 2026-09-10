# Runner Docker local UniExam

Ce processus Node est distinct de NestJS. Il reçoit uniquement un identifiant de langage, une source et une entrée standard. Il lance Docker avec `spawn(..., {shell:false})` ; aucun code étudiant n’est exécuté par Node ou le shell Windows. Il sert les exercices console et SQLite. Il ne fournit pas de terminal système général, installation de paquets, serveur Web persistant ou projet multi-fichiers étudiant.

## Démarrage

Depuis la racine du dépôt, Docker Desktop doit être démarré en mode Linux. Le lanceur `scripts/local-runner.mjs` charge la configuration privée et ne transmet au processus enfant qu’une liste autorisée de variables. Son arrêt utilise un message IPC Windows et attend le nettoyage.

Le daemon direct se lance également avec :

```powershell
node --import tsx infrastructure/local-runner/server.ts
```

Variables requises : `RUNNER_AUTH_TOKEN` (16 à 256 octets, même valeur que NestJS), `LOCAL_RUNNER_DOCKER_PATH` (chemin absolu du CLI si absent du PATH). Le dossier Docker `resources/bin` doit figurer dans le PATH du processus pour le gestionnaire d’authentification Docker pendant les téléchargements. Le token ne doit jamais apparaître dans une URL, un argument CLI ou un journal.

L’écoute est fixée à `127.0.0.1:4200`. Tous les endpoints demandent `X-Auth-Token` avec comparaison à temps constant des empreintes. Les requêtes comportant un en-tête navigateur Origin sont refusées. Le port reste privé à cette machine, aucun port de conteneur n’est publié.

## Préparation explicite des images

```powershell
# Téléchargements/construction seulement avec --pull.
node --import tsx infrastructure/local-runner/bootstrap.ts --pull --only php,python,java
node --import tsx infrastructure/local-runner/bootstrap.ts --pull

# Réexécuter les sondes sur les images déjà présentes, sans téléchargement.
node --import tsx infrastructure/local-runner/bootstrap.ts
```

Le catalogue utilise des images officielles à versions nommées. JavaScript, TypeScript, Bash et SQLite partagent une image basée sur Node officiel, avec les versions npm exactes dans son Dockerfile. Les paquets Alpine et les bases peuvent évoluer lors d’une nouvelle préparation ; le manifeste conserve ensuite l’ID d’image SHA-256 immuable et les RepoDigests disponibles. Les programmes emploient exclusivement cet ID avec `--pull never`. Une nouvelle préparation implique une nouvelle vérification, pas une mise à jour implicite des examens.

Un langage n’est disponible qu’après présence de l’image et exécution réelle du programme de vérification dans le conteneur inspecté. Les réussites sont inscrites dans `.data/verified-images.json`, les échecs restent indisponibles. Le script peut donc terminer en erreur tout en conservant les autres langages réellement validés. La matrice `scripts/verify-docker-runtimes.mjs` vérifie ensuite les programmes valides, erreurs, entrées et limites via HTTP. Les tests `test/runner.test.ts` sont des simulations de contrat, jamais une preuve de compilation.

## Isolation et bornes

- Deux conteneurs simultanés au maximum, sonde de santé comprise ; vingt tâches supplémentaires en attente,200 résultats retenus au maximum et expiration après10minutes. La file locale est volatile : les jobs non terminés ne sont pas repris après un redémarrage.
- Conteneur non privilégié, UID/GID65534, racine en lecture seule, réseau `none`, toutes les capabilities retirées, `no-new-privileges`, journal Docker désactivé.
- Un seul bind du dossier UUID de la tâche vers `/work`, en lecture seule. Il contient la source au nom fixé par le catalogue, ainsi que les deux fichiers de projet C# immuables si nécessaire. Aucun fichier `.env`, code applicatif, secret ou socket Docker n’est monté.
- 1CPU,768Mio de mémoire sans swap supplémentaire,128 processus,256 descripteurs,16Mio de mémoire partagée ; `/tmp` éphémère de128Mio avec `nosuid,nodev`. La base SQLite est créée uniquement dans `/tmp`.
- Corps HTTP64Kio ; source30 000octets et entrée4 000octets. Compilation45secondes au total, exécution5secondes. Sortie standard, erreur et journal de compilation limités à32Kio chacun. Un dépassement supprime le conteneur entier et ses descendants.
- Les options réellement appliquées sont relues par `docker inspect` avant toute compilation/exécution. `/health` lance aussi une sonde d’UID après démarrage, avec un cache court et une promesse partagée. Une image présente seule ne constitue pas une validation.

Les métriques `time_seconds` correspondent au temps écoulé de la phase d’exécution, avec le coût Docker CLI ; `memory_kb` est `null`, aucune mesure mémoire n’est inventée. Les commandes de compilation sont fixes. C# utilise un projet net8.0 sans dépendances externes, une configuration NuGet sans sources, le cache `/tmp`, puis `build --no-restore`. Les téléchargements de dépendances étudiantes sont indisponibles.

## Arrêt et maintenance

L’arrêt IPC attend les tâches et leurs blocs de nettoyage. Un échec de suppression du conteneur ou du dossier met le moteur en défaut et interdit les nouveaux programmes. Le processus de contrôle du conteneur expire aussi après120secondes. Au redémarrage, après acquisition du port fixe, le runner ne purge que les dossiers UUID dont le processus propriétaire est mort et dont la propriété du conteneur est confirmée. Les tâches d’un bootstrap encore vivant sont conservées. Les dossiers incomplets sans propriétaire vérifiable demandent un contrôle manuel ; au-delà de500 dossiers le service refuse de démarrer.

Les sources ne sont pas journalisées. Les résultats demeurent en mémoire du daemon pendant leur durée de rétention. Le dossier parent des tâches utilise0700 sur les hôtes POSIX ; sous Windows, protéger aussi les ACL du compte et ne pas partager ce répertoire.

Ce moteur convient à une démonstration ou un poste de développement. Les conteneurs partagent le noyau Linux Docker ; ce n’est ni une preuve de résistance à toutes les vulnérabilités noyau, ni une capacité de production mesurée. Le déploiement multi-établissements nécessite des hôtes d’exécution dédiés, correctifs, quotas et tests de charge séparés.

Sources primaires : [limites et options Docker](https://docs.docker.com/engine/containers/run/), [référence docker run](https://docs.docker.com/reference/cli/docker/container/run/), [restauration .NET et configuration NuGet](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-restore).
