# MySQL Community 8.4 pour les devoirs SQL

Le moteur exécute réellement le script `/work/query.sql` avec MySQL 8.4. Chaque
travail démarre une base vierge ; les tables disparaissent après cette exécution.
Les exercices en plusieurs étapes doivent donc inclure leur schéma et leurs données
dans le même script. `DELIMITER` et les procédures stockées sont pris en charge.
L’entrée standard séparée n’est pas utilisée pour ce type de devoir.

L’image conserve les binaires et notices de l’image officielle
`container-registry.oracle.com/mysql/community-server:8.4`, en supprimant ses
métadonnées de volume et de démarrage automatiques. Le bootstrap épingle ensuite
l’identifiant immuable de l’image après une vraie requête de contrôle.

Le serveur et le client tournent comme UID 65534. Le serveur écoute uniquement sur
un socket Unix interne, sans interface réseau. Le compte étudiant ne possède que
des droits sur `exam.*` ; aucun droit global, `FILE`, `SUPER`, création de compte ou
délégation de privilèges. Le client utilise le mode binaire non interactif, qui
interdit ses commandes locales shell/fichiers, et désactive `LOCAL INFILE`.
[Image officielle](https://dev.mysql.com/doc/refman/8.4/en/docker-mysql-getting-started.html),
[options du client](https://dev.mysql.com/doc/refman/8.4/en/mysql-command-options.html).

Le profil impose une racine en lecture seule, aucun réseau, aucun privilège Linux
additionnel, 1 Gio de mémoire totale, 512 Mio de tmpfs et un travail exclusif. Le démarrage
de confiance a un délai distinct de 90 s ; le SQL étudiant a 5 s et 32 Kio de sortie.
Le conteneur complet est supprimé après succès, erreur ou dépassement de durée.

Recette réelle validée le 10 septembre 2026 sur Docker Desktop Linux : dix scénarios
environ 64 s au total, avec SELECT 42/version 8.4, table/insertion/procédure, erreur 1064,
isolation entre travaux, refus de lecture des comptes serveur, de GRANT FILE,
d’OUTFILE, de LOCAL INFILE et des commandes shell/source, ainsi qu’arrêt d’une requête
trop longue. L’initialisation prenait environ 4–5 s par travail sur ce poste.

Le test est opt-in : `UNIEXAM_TEST_MYSQL=1 node --import tsx --test
infrastructure/local-runner/test/mysql-live.test.ts` (adapter la définition de
variable à PowerShell sous Windows). Il ne touche ni la base de l’application ni
le manifeste partagé d’images disponibles. Ces mesures locales ne démontrent pas
une capacité de production ou une exécution MySQL intégrée aux projets PHP.
