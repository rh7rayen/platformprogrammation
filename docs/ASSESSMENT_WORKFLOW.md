# Devoir complet : parcours et règles à implémenter

**État : PARTIAL — spécification cible.** Sont désormais livrés : cycle de devoir, codes personnels, tentative unique, minuteur serveur, sauvegarde, remise, correction, résultats, Monaco pour 14 langages/environnements et aperçu Web à trois fichiers. Les adaptateurs Judge0, Resend avec réémission après échec et Storage vidéo privé sont fournis mais leurs services distants restent non configurés dans la démonstration. La similarité locale ne détecte pas une provenance IA. Les aménagements, banques/versionnement avancé, projets frameworks complets, surveillance live et autres règles décrites ci-dessous restent une cible lorsqu’ils ne figurent pas dans [EXAMS_IMPLEMENTED.md](EXAMS_IMPLEMENTED.md) et [PROJECT_STATUS.md](../PROJECT_STATUS.md).

## Parcours enseignant

1. Choisir un enseignement autorisé et un mode : QCM/questions, rédaction, mathématiques/sciences, programmation, SQL/PLSQL, projet framework, mixte.
2. Créer titre, consignes, questions versionnées et barème. L’IA peut proposer du contenu privé, jamais publier ou attribuer une note sans règle validée.
3. Définir ouverture, fermeture, durée, tentatives et aménagements. Choisir les classes ou étudiants destinataires.
4. Choisir les outils : pour Python, Monaco et un runtime Python versionné ; pour un devoir rédactionnel, éditeur de texte sans IDE imposé. Python est exécuté par son interpréteur ; Java/C# nécessitent aussi une compilation.
5. Configurer la politique de collage et de surveillance : OFF, EVENTS_ONLY, LIVE_SCREEN ou LIVE_SCREEN_WITH_RECORDING. Enregistrement désactivé par défaut.
6. Prévisualiser la version étudiant. La publication vérifie destinataires, dates, total de points, corrigés requis et disponibilité réelle des runtimes.
7. Publier puis envoyer les codes via une file d’emails idempotente avec rapport de livraison. Aucune simulation d’email « envoyé » en cas d’échec SMTP.
8. Suivre les tentatives, consulter les enregistrements autorisés, corriger, publier les résultats et traiter les réclamations.

## Accès par code reçu par email

Un code correspond à un **destinataire et une évaluation**, pas à un accès anonyme universel. L’université peut demander une connexion existante ou une vérification par lien/OTP envoyé à l’adresse attendue avant d’échanger le code contre un accès à la tentative. Un code transmis à une autre personne ne remplace pas cette vérification d’identité.

- Secret aléatoire cryptographiquement sûr, empreinte serveur, durée de validité, tentative d’accès limitée par identité et IP.
- Réponse générique pour code inconnu, expiré, annulé ou autre destinataire ; aucun détail d’étudiant exposé.
- Échange atomique, traçabilité et idempotence. La reconnexion reprend la tentative existante, sans nouveau chronomètre.
- Réémission annule le code précédent. Un lien contient le minimum nécessaire et les secrets ne sont pas journalisés.
- File d’envoi par université, clé d’idempotence par invitation/version, retry borné, état `QUEUED/SENT/FAILED`. `SENT` signifie accepté par le fournisseur, pas preuve de lecture.

## Temps, sauvegarde et remise

Le serveur fixe `deadline = min(effective_close_at, started_at + granted_duration)`. L’ouverture individuelle remplace l’ouverture générale si elle est autorisée ; la prolongation individuelle remplace la fermeture pour cet étudiant ; le temps supplémentaire augmente la durée. Toutes les dates sont UTC, affichées dans le fuseau configurable de l’établissement.

Les réponses ont une version monotone et un accusé de réception. Une ancienne version ne peut écraser la plus récente. Le temps de réception serveur décide de la recevabilité ; le temps du navigateur n’accorde jamais de prolongation. À expiration, le worker finalise une seule fois la dernière version enregistrée. Il continue même si le navigateur est fermé ; du texte uniquement hors ligne ne peut pas être récupéré par promesse.

La copie remise est immuable et conserve les versions de question, runtime, sources et tests. La correction peut commencer après la deadline si la remise a été reçue à temps. Une erreur d’infrastructure ne devient pas automatiquement zéro.

## Espace Python et autres environnements

Monaco Editor, navigation entre questions, consignes, état réseau, sauvegarde serveur, chronomètre, console et entrées publiques. Les profils de runtime possèdent une version, une image épinglée, des commandes autorisées et des limites CPU/RAM/processus/stockage/temps/sortie.

Seuls les profils **RUNNABLE** testés affichent Exécuter. **EDIT_ONLY** permet l’édition avec remise mais sans exécution. **UNAVAILABLE** explique l’absence de l’environnement. À ce jour tous les runtimes pédagogiques sont UNAVAILABLE.

L’API crée un job durable ; BullMQ transmet au contrôleur sur un hôte distinct. Le code étudiant tourne sans privilèges, sans socket Docker, sans réseau externe et sans secret de plateforme. Le déploiement devra valider une isolation renforcée (gVisor ou microVM), pas seulement des conteneurs standards. Le runner n’accepte pas une commande arbitraire du navigateur.

Ordre cible : Python, PHP, JavaScript, Java, C# console ; SQL PostgreSQL/MySQL ; véritable Oracle PL/SQL ; projets Laravel, Symfony, React, Angular, Vue, Flask, Django, Spring Boot et ASP.NET Core. Builds, dépendances et previews sont isolés. Les exercices SQL ne touchent jamais PostgreSQL métier ; chaque tentative a sa base pédagogique privée.

## Collage, partage et enregistrement

La politique peut intercepter `paste`, `copy`, `cut`, `drop` et les commandes de collage dans l’espace d’épreuve, avec message accessible. Elle ne contrôle ni les autres applications, ni un second appareil, ni les outils de développement. Elle ne lit pas le presse-papiers global et ne supprime pas le travail de l’étudiant. Aménagements et revue humaine restent possibles.

`getDisplayMedia()` est appelé après une action explicite de l’étudiant et uniquement en contexte sécurisé. Prévisualisation, indicateur permanent, arrêt du partage, permission refusée et reprise sont traités. L’application ne prétend pas choisir secrètement un écran ou redémarrer une capture sans permission.

Pour le direct, WebRTC et une signalisation authentifiée transmettent réellement les images à un surveillant affecté ; STUN/TURN et éventuellement SFU sont séparés de l’API métier. Le test d’acceptation nécessite deux comptes et la réception effective du flux.

Pour l’enregistrement, `MediaRecorder` peut produire des segments numérotés et téléversés avec accusé de réception vers un bucket privé. Le backend lie chaque segment à l’université, à l’épreuve, à l’étudiant et à la session. Un manifeste final détecte segments manquants, doublons et interruptions. Un arrêt de navigateur crée un enregistrement incomplet explicitement indiqué, pas une vidéo prétendument complète. La durée, le format et les quotas sont validés côté serveur.

L’enseignant reçoit un **accès dans son tableau de bord**, et éventuellement une notification, à tous les enregistrements des étudiants de ses examens autorisés. Les fichiers ne sont pas joints à des emails publics. Lecture par URL signée courte, autorisation serveur avant signature, accès audité, rétention configurable et purge. Les vidéos d’autres enseignants/universités ne sont pas consultables. Webcam, microphone et biométrie restent hors périmètre par défaut.

## Similarité et usage d’IA

Ne pas afficher un pourcentage présenté comme preuve certaine d’écriture par IA. Une analyse peut signaler des passages similaires, retirer le code de départ et présenter des éléments explicables pour une revue humaine. Focus, collage et coupures réseau sont des événements imparfaits, pas des preuves. Aucun signal ne provoque accusation, sanction ou note zéro automatique. Prévoir commentaires, décision humaine et contestation.

## Critères du prochain lot utilisable

- Un enseignant de français et un enseignant de programmation peuvent publier une épreuve avec les outils adaptés.
- Le destinataire reçoit effectivement son email dans une boîte de test ; un autre compte ne peut pas utiliser son code.
- Rafraîchir ou reconnecter ne remet pas le temps à zéro ; sauvegarde et remise survivent à la fermeture du navigateur selon les règles serveur.
- Aucun corrigé, `is_correct` ou test caché dans le payload étudiant.
- Le moteur Python n’est annoncé fonctionnel qu’après des tests réels d’exécution, d’erreur, boucle infinie, sortie excessive et isolation.
- Aucun écran enregistré n’est annoncé disponible sans upload validé et lecture effective depuis un compte enseignant autorisé.
