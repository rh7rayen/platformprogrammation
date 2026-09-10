# Prototype Oracle Database Free — non activé

Ce dossier concerne un vrai moteur Oracle SQL et PL/SQL. L’éditeur seul ne prouve
pas que le moteur est disponible. Le catalogue ne doit annoncer une exécution
Oracle qu’après une requête et un bloc PL/SQL réellement validés sous la politique
d’isolation décrite ci-dessous.

**Résultat constaté : stockage insuffisant pour le profil demandé.** L’inspection
réelle de l’image officielle a mesuré **3 401 098 568 octets** décompressés pour la
base préconstruite (environ 3,17 Gio), avant même la création de `FREEPDB1`. Le
tmpfs autorisé est de **2 147 483 648 octets** (2 Gio). Le script officiel emploie
`gunzip` vers `oradata`, puis crée le PDB étudiant à partir de `pdbseed`.
L’initialisation n’a donc pas été lancée, aucun volume persistant n’a été ajouté,
et les limites de WSL n’ont pas été modifiées. Oracle reste indisponible à l’exécution.

La mesure est reproductible avec
`node --import tsx infrastructure/local-runner/oracle-prototype.ts --inspect`.
Cette commande utilise au maximum 256 Mio de RAM dans un conteneur de lecture
isolé, vérifie sa politique avec Docker inspect, puis le supprime. Le résultat
`RESOURCE_BLOCKED` retourne le code 2 ; il ne s’agit pas d’un test SQL réussi.

## Image et accès vérifiés le 10 septembre 2026

- Image officielle : `container-registry.oracle.com/database/free:latest-lite`.
- Index multiplateforme : `sha256:cf540c3fa190d7cffad08c491652ac07fc70314e510f6b87890449517d565e94`.
- Manifeste Linux amd64 : `sha256:770ca58ab319d8cfde610b0db25c06899ce0af9591c4addfa10d2cb8f0318e65`.
- Total des couches compressées téléchargées : 895 941 079 octets, environ 854 Mio.
  Dans l’image, `du -sk` mesure 390 928 Kio pour les archives de données et
  1 085 836 Kio pour le répertoire des binaires Oracle ; les données décompressées
  ci-dessus sont plus volumineuses. Ces tailles ne sont pas une estimation de RAM.
- Le registre a fourni un jeton anonyme puis les manifestes/configuration avec
  HTTP 200, sans compte ni mot de passe. Aucun jeton n’a été journalisé. Cette
  observation ne remplace pas les conditions de licence du logiciel.
- La configuration officielle indique `USER=oracle`, `RUN_AS_ORACLE=true`, aucun
  `VOLUME` implicite et un script `runOracle_lite.sh`. Son historique indique des
  données préconstruites sous `/opt/oracle/tmp_oradata`.

Oracle autorise explicitement les enseignants et étudiants à utiliser Free pour
l’enseignement des bases de données. Le produit reste soumis aux conditions
Free Use. Les limites sont deux CPU, deux Go pour SGA/PGA et douze Go de données
utilisateur, avec une installation par environnement logique. La documentation
d’installation donne un minimum de 1 Go de RAM, recommande 2 Go et demande 10 Go
de disque ; la consommation globale d’un conteneur ne se limite pas à SGA/PGA.
[Produit et enseignement](https://www.oracle.com/database/free/),
[licence](https://www.oracle.com/downloads/licenses/oracle-free-license.html),
[limites](https://docs.oracle.com/en/database/oracle/oracle-database/26/xeinl/licensing-restrictions.html),
[prérequis](https://docs.oracle.com/en/database/oracle/oracle-database/26/xeinl/requirements.html).

## Essai local borné proposé

1. Préparer l’image figée puis inspecter les scripts et tailles, sans lancer la
   base. Aucune configuration de compte utilisateur ou service cloud n’est requise.
2. Conserver les binaires et mentions de licence. Diriger uniquement les fichiers
   Oracle modifiables vers un tmpfs privé de 2 Gio maximum ; la racine reste en
   lecture seule. Aucun volume Docker persistant ou dossier hôte modifiable.
3. Démarrer une seule base à la fois, après avoir vidé les autres travaux du runner.
   Imposer 3 Gio de mémoire totale, aucun supplément de swap, un CPU, 256 Mio de
   mémoire partagée, des limites de processus et fichiers, `--cap-drop ALL`,
   `no-new-privileges`, `--network none`, et aucune publication de port.
4. Le démarrage administratif se fait comme utilisateur OS Oracle, uniquement avec
   des instructions de confiance. L’exécution étudiante utilise UID 65534 sans
   groupe DBA et un compte SQL limité dans `FREEPDB1`, avec quota de tablespace.
   Sa connexion passe par `127.0.0.1` dans le conteneur. Le réseau `none` conserve
   cette interface de boucle locale.
5. Limiter le démarrage séparément du temps de la copie, puis limiter chaque script
   SQL à cinq secondes et chaque sortie à 32 Kio. Supprimer le conteneur complet à
   la fin ou à l’expiration, avant de traiter la copie suivante.

Un client SQL*Plus doit utiliser `-R 3` pour interdire `HOST`, `SPOOL`, `GET`,
`START`, `@` et `@@`. Cette option ne désactive pas `CONNECT` : la séparation des
comptes OS est indispensable pour interdire `CONNECT / AS SYSDBA`. Un pilote Oracle
limité à l’exécution SQL évite les métacommandes, à condition de traiter correctement
les scripts et les blocs PL/SQL, sans les découper naïvement sur les points-virgules.
[Sécurité SQL*Plus](https://docs.oracle.com/en/database/oracle/oracle-database/26/sqpug/SQL-Plus-security.html),
[réseau Docker none](https://docs.docker.com/engine/network/drivers/none/).

## Critères de disponibilité

Il faut obtenir `SELECT 42 FROM dual`, `DBMS_OUTPUT.PUT_LINE`, une procédure stockée
avec données locales, une erreur Oracle explicite et l’arrêt d’une boucle PL/SQL.
Il faut aussi vérifier le refus de l’authentification DBA, des fichiers et des
privilèges administratifs, la séparation de deux travaux et la suppression des
fichiers temporaires. Un dépassement des 2 Gio de tmpfs ou des 3 Gio de mémoire
constitue un résultat bloquant pour ce profil, pas une raison de retirer les limites.

Avec WSL limité à 4 Gio et deux CPU, l’exécution doit être exclusive : deux bases
Oracle/MySQL et les compilateurs simultanés n’ont pas de marge démontrée. Un profil
WSL de 8 Gio et quatre CPU sur l’hôte de 24 Gio serait une proposition pour la suite,
à confirmer par mesure et à configurer explicitement, sans modification automatique.

Oracle précise que Free n’a pas de support ni de correctifs, y compris de sécurité.
Ce prototype local ne valide donc pas un service public de code hostile à grande
échelle. [FAQ officielle](https://www.oracle.com/database/free/faq/).
