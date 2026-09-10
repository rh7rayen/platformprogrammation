# Devoirs et ateliers livrés

Le module `backend/src/assessments` repose sur la migration `003_assessments.sql`, complétée par les runtimes, la vidéo et les invitations dans les migrations 004 à 007. Le frontend ouvre Devoirs & examens par défaut et propose un atelier Monaco multi-langages. Les métadonnées passent par le BFF et Nest ; les octets vidéo vont directement au stockage privé lorsqu’il est configuré.

## Accès, travail et remise

- L’auteur doit être affecté à l’enseignement. La publication attribue le devoir aux inscrits de sa classe ; le rôle administrateur n’autorise pas implicitement la correction ou la lecture des vidéos.
- Un brouillon comporte 1 à 30 questions : programmation, QCM à réponse unique ou rédaction. Le catalogue propose 14 langages/environnements. La publication fige contenu, barème et dates ; les réponses attendues QCM restent dans une table privée.
- Les codes personnels de 80 bits sont normalisés et hachés, liés au compte et au devoir. La publication les affiche une seule fois. Les invitations Resend configurables remplacent le code initial ; une réémission après FAILED/EXPIRED doit être explicite, avant début et fermeture, avec quota et historique.
- Deux démarrages concurrents reprennent une tentative unique. Échéance = minimum de la fermeture et de l’heure serveur de début + durée. Le seed ne modifie pas une échéance existante.
- La sauvegarde vérifie la version de réponse et la tentative. `409` signale un conflit ; `410` une tentative terminée. Changer de question/fichier conserve le tampon en mémoire ; un rechargement retrouve la version sauvegardée.
- La remise atomique crée une copie, fige les réponses et note les QCM. Le traitement d’expiration rattrape les devoirs arrivés à terme même sans navigateur ; lire une tentative expirée la finalise également.
- L’enseignant corrige code et rédaction avec barème, version et historique. Les résultats sont diffusables après fermeture et correction complète, puis verrouillés.
- Une copie remise reste visible à l’enseignant affecté après un changement de classe de l’étudiant ; le nom est masqué si le profil n’est plus dans le périmètre courant. Le déplacement ne supprime ni copie ni réponse.

## Édition et exécution

Monaco est servi localement, reconstruit depuis ESM avec DOMPurify 3.4.15 et workers du même serveur. Les anciens assets AMD contenant 3.4.8 ont été supprimés du répertoire public généré. La saisie est possédée par le tampon Monaco et remontée vers l’autosave ; la page affiche explicitement ce qui n’est pas encore enregistré.

Python, PHP, Java, JavaScript, TypeScript, C, C++, C#, Go, Rust, Ruby et Bash disposent d’un adaptateur Judge0 privé, d’une file durable et de sorties bornées. Ils ne deviennent exécutables qu’après configuration et vérification du runner réel. Docker est absent de ce poste et aucune compilation distante réelle n’y a été validée. Aucun programme étudiant n’est exécuté dans NestJS. SQL reste en édition seule.

Le profil Web utilise exactement `index.html`, `style.css` et `script.js` ; l’aperçu interactif isolé permet d’essayer les changements sans runner serveur. Les trois fichiers font partie de la réponse et de la copie. Ce lot ne lance pas d’application backend persistante, d’installation de dépendances réseau ou de projet serveur arbitraire à plusieurs fichiers.

Les formulaires peuvent réagir localement à `submit` avec `preventDefault` : l’iframe utilise `allow-scripts allow-forms`, sans `allow-same-origin`. La directive CSP `form-action 'none'` interdit leurs envois réseau ; le test navigateur vérifie l’événement de blocage et l’absence de requête. Ce choix suit les [restrictions iframe documentées par MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe). La restriction des sous-ressources ne garantit pas l’interdiction de toute navigation du cadre lui-même.

## Emails, capture et revue

Les invitations aux étudiants déjà destinataires disposent d’une file chiffrée, d’une clé d’idempotence et d’un état d’envoi. Sans domaine/clé/HTTPS configurés, aucun email n’est envoyé. Elles ne créent pas de compte Supabase. La migration 007 permet trois réémissions explicites sur 24 h après échec/expiration, conserve les jobs précédents et empêche un acquittement tardif de modifier le remplacement.

Le composant de capture demande un consentement et la surface à enregistrer. Il transfère des segments indépendants vers Supabase Storage privé ; l’API vérifie taille et MIME réels. L’enseignant affecté peut lire les segments via liens courts. Sans bucket configuré, aucune capture n’est déclenchée. La purge cloud doit être planifiée et testée : voir `VIDEO_STORAGE.md`.

La comparaison de copies est lexicale et locale, avec exclusion des séquences du code de départ. Ses extraits servent à une revue humaine ; elle ne prouve ni une fraude ni un usage d’IA et ne modifie aucune note. Le contrôle du presse-papiers reste contournable par un client modifié ou un autre appareil.

## Limites et vérification

Une session de connexion dure au plus une heure ; la reconnexion ne remet pas à zéro le temps du devoir. Aucune sauvegarde hors ligne n’est garantie. Les listes de devoirs sont limitées aux 100 derniers accessibles et le BFF à 64 Kio par requête : réduire les énoncés ou projets trop volumineux. Les questions publiées et résultats diffusés ne sont pas éditables dans cette version.

Les tests d’intégration utilisent NestJS et les migrations réelles sur PostgreSQL/PGlite. Les tests de contrat des intégrations utilisent explicitement un faux runner, un faux fournisseur d’email et un stockage simulé. La vérification Monaco utilise Chrome et les assets réellement produits ; les parcours de l’application testent saisie, autosave, reprise, QCM, Web, remise et correction. Le bilan consolidé de la dernière recette figure dans `PROJECT_STATUS.md`.

Les essais locaux ne remplacent pas une recette Supabase distante, l’audit des hôtes d’exécution ou une campagne de charge. Les procédures de connexion réelle sont dans `CLOUD_ACTIVATION.md`, l’architecture de capacité dans `CAPACITY_PLAN.md` et le résultat de revue dans `SECURITY_REVIEW.md`.
