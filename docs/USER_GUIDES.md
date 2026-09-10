# Guides de la plateforme

## Démonstration Ingénieur 1

Ouvrir [Devoirs & examens](http://localhost:3000/?view=exams). Choisir **Sami Haddad** pour enseigner PHP/Java/Web ou **Lina Ben Salem** pour suivre les trois ateliers Ingénieur 1. Les comptes sont fictifs ; les réponses et remises sont persistantes.

| Devoir de Lina | Code personnel de démo | Espace ouvert |
| --- | --- | --- |
| PHP · Calculer un panier | `DEMO-PHP` | `main.php` |
| Java · Gestion des notes | `DEMO-JAVA` | `Main.java` |
| Web · Créer une page interactive | `DEMO-WEB` | `index.html`, `style.css`, `script.js`, aperçu |

Saisir le code, valider, **Ouvrir mon devoir**, puis **Commencer le devoir**. Les ateliers Ingénieur 1 ont une durée de 120 minutes, dans la limite de leur fermeture. Démarrer le devoir lance son temps réel : fermer la page, se déconnecter ou recharger ne le remet pas à zéro.

## Enseignant

1. Choisir **Créer un devoir** dans Devoirs & examens.
2. Dans la première étape, sélectionner **Classe**, par exemple Ingénieur 1, puis l’**Enseignement** affecté, par exemple Développement PHP. La publication attribuera le devoir aux étudiants actuellement inscrits dans cette classe.
3. Définir titre, type de devoir, dates, durée et politique de collage. À l’étape des questions, choisir **Format → Programmation**, puis **Langage de programmation → PHP**, **Java**, **Web** ou un autre langage et définir le barème. QCM et rédaction restent disponibles dans le même devoir.
4. Rédiger l’énoncé et le code de départ, puis enregistrer le brouillon. Les projets Web utilisent les trois fichiers imposés.
5. Vérifier et **Publier**. Les questions, dates et barèmes deviennent immuables ; télécharger les codes affichés une fois.
6. Utiliser **Inviter les étudiants** pour sélectionner les destinataires ou saisir leurs emails. Les adresses doivent correspondre aux étudiants actifs déjà affectés au devoir. **Envoyer les invitations** n’est disponible que si le service email est configuré.

Chaque envoi email crée un nouveau code et remplace le code initial du destinataire. « En attente » et « Envoi en cours » ne signifient pas reçu. « Accepté par le service email » correspond à SENT ; l’établissement doit encore vérifier la réception réelle. Sans configuration, transmettre soi-même les codes téléchargés : aucun faux email envoyé n’est annoncé.

Après échec ou expiration, **Réessayer** peut créer une nouvelle invitation et un nouveau code, si l’étudiant n’a pas commencé et si l’examen reste ouvert. La limite est de trois réémissions en 24 heures par destinataire. Les invitations déjà acceptées ne sont pas réémises arbitrairement et leur ancien historique est conservé. Ce parcours invite à un devoir ; il ne crée pas un compte Supabase.

**Voir les copies** présente les remises. Les QCM sont notés automatiquement ; le code et les textes sont corrigés manuellement. Renseigner note et commentaire puis **Enregistrer la correction**. **Publier les résultats** exige la fermeture du devoir et la correction de toutes les copies. Les étudiants ne voient leurs notes qu’après cette publication.

Les copies remises restent consultables même si l’étudiant change ensuite de classe ; si son profil n’est plus visible dans le périmètre courant, son identité affichée est masquée sans perdre la copie. La revue donne aussi accès aux captures reçues lorsque le stockage privé a été configuré. Les segments sont lus par liens temporaires ; si un lien expire, cliquer de nouveau sur le segment. Un rôle administrateur seul ne donne pas accès aux vidéos.

La revue de similarité compare localement des séquences communes entre copies autorisées et présente des extraits. Une solution commune, une consigne très cadrée ou du code court peut influencer le résultat. Ce n’est ni un détecteur fiable d’IA ni une preuve de fraude. Aucune sanction ni note n’est changée automatiquement.

L’**Assistant IA** peut préparer des propositions de QCM si son fournisseur est activé. Saisir un objectif pédagogique sans données personnelles ; relire les propositions privées avant toute utilisation. Elles ne sont pas automatiquement publiées et ne corrigent pas les étudiants.

## Étudiant : coder, tester et remettre

Après ouverture, le panneau de gauche présente les questions et l’énoncé. Écrire dans l’éditeur, changer de question ou de fichier, puis attendre **Enregistré**. **Enregistrer maintenant** relance une sauvegarde. **Mes devoirs** attend la sauvegarde avant de revenir à la liste.

**Agrandir l’éditeur** utilise toute la largeur du devoir sans recharger le code. Le sélecteur **Question en cours** et **Lire la consigne** remplacent le panneau latéral. **Réduire l’éditeur**, ou Échap, rétablit la disposition initiale. Les boutons **− / +** règlent le texte entre 12 et 24 pixels ; **Masquer la console** libère de la hauteur. Ces réglages ne changent ni la réponse ni le temps restant.

**Plein écran** agrandit toute la plateforme avec le minuteur, si le navigateur l’autorise. **Quitter le plein écran** revient à la fenêtre normale ; le code reste chargé. Un refus du navigateur affiche une explication et laisse le mode agrandi disponible.

Si l’éditeur indique **Cette copie a été remise**, la tentative est terminée : sa réponse reste en lecture seule, même en mode agrandi. Cliquer **Ouvrir un autre devoir** pour choisir un devoir encore disponible ; une ancienne remise n’est jamais déverrouillée pour une démonstration.

Pour **PHP, Java et les autres runtimes**, Exécuter sauvegarde le code puis lance cette version si le service Docker ou Judge0 a validé le langage. La console s’ouvre automatiquement et sépare **Sortie**, **Compilation** et **Erreurs**. **Entrée standard** permet de fournir les données que le programme lit avec `input`, `Scanner`, `STDIN`, etc. **Vérifier le compilateur** actualise sa disponibilité et **Effacer** vide l’affichage du dernier résultat. Ce panneau est une console d’exécution : il ne fournit pas un shell interactif ni un serveur d’application permanent. Le dernier résultat affiché n’est pas restauré au rechargement.

SQL utilise SQLite dans un conteneur éphémère avec le fournisseur Docker. La base de données du site reste inaccessible aux programmes étudiants. Le Web HTML/CSS/JavaScript conserve son aperçu indépendant du runner. Si Docker est arrêté ou si une image n’est pas préparée, l’interface explique l’indisponibilité sans annoncer une exécution réussie.

Pour **Web**, utiliser `index.html` pour le contenu, `style.css` pour la présentation et `script.js` pour les interactions. Actualiser l’aperçu intégré après modification et essayer ses boutons. L’aperçu est isolé et ne donne pas accès aux cookies de la plateforme. Les ressources réseau et les frameworks/dépendances téléchargés ne sont pas pris en charge. Remettre conserve les trois fichiers dans la copie.

Si le stockage est disponible, lire l’information de conservation et accepter la capture avant de cliquer **Choisir un écran et enregistrer**. Le navigateur demande la surface à partager. Aucun microphone ni webcam n’est capturé ; **Arrêter la capture** reste disponible. Les compteurs distinguent les segments reçus et ceux en attente. En cas d’échec, réessayer le transfert avant de fermer l’onglet. Une vidéo non transférée peut être perdue au rechargement. Sans stockage configuré, aucune vidéo n’est envoyée à l’enseignant.

Pour vérifier son matériel sans cloud, ouvrir **Tester la capture sur cet appareil** pendant un devoir actif. Accepter le test local puis choisir une surface dans la fenêtre du navigateur. **Arrêter le test local** permet de lire et **Télécharger la vidéo locale**. Le test s’arrête après 60 secondes, conserve au maximum 8 Mio de données vidéo et ne contacte aucun service pour transmettre la vidéo. Télécharger avant de quitter la page ou de recommencer : ce fichier ne fait pas partie de la copie et l’enseignant ne le reçoit pas.

**Remettre ma copie** demande confirmation, sauvegarde puis verrouille la remise. À expiration, le serveur remet la dernière version enregistrée même si le navigateur est fermé. La capture s’arrête et tente de transférer son dernier segment. Une seule tentative est autorisée. Les résultats apparaissent après publication par l’enseignant.

En cas d’erreur réseau, la page indique ce qui n’est pas enregistré ; aucune sauvegarde hors ligne n’est garantie. Une réponse modifiée ailleurs déclenche un conflit : ne pas ignorer le message, car un rechargement explicite remplace les changements locaux par la version serveur. Le blocage du copier-coller dépend du devoir et ne garantit pas l’absence d’outils externes.

La session de connexion expire au plus tard après une heure. Se reconnecter avec le même compte ne réinitialise pas le temps du devoir et redonne accès aux réponses déjà sauvegardées. Se déconnecter après usage sur un ordinateur partagé.

## Administrateur et autres comptes

Choisir **Amira Ben Ali** en mode démo. Le sélecteur d’université ne montre que les adhésions autorisées. Créer la structure dans l’ordre : établissement facultatif, département, formation, spécialité, niveau, année, semestre, classe, groupe, matière, enseignement. Les incohérences de dates et périmètres sont rejetées côté serveur. Les champs de relation des catalogues ont encore une sélection limitée ; une recherche adaptée à de très grandes universités reste à développer.

Dans **Équipe & étudiants**, consulter et rattacher un profil existant par UUID, ou suspendre un membre. Cette interface ne provisionne pas encore tous les nouveaux comptes Supabase et ne propose pas un parcours complet d’inscription/invitation de compte. Dans **Affectations**, associer les enseignants à leurs enseignements et inscrire les étudiants à leur classe. Les rôles nécessaires doivent déjà exister. Une suspension retire l’accès à l’université concernée et conserve l’historique.

La création/consultation sont disponibles ; archives avancées, récupération, MFA, SSO, imports et écran détaillé d’audit restent à réaliser. L’administration n’obtient pas les copies et vidéos par son seul rôle : la correction appartient à l’enseignant affecté.

Les comptes historiques **Yassine**, **Inès**, **Nour** et **Adam** restent disponibles. **Nour → PYTHON-DEMO** ouvre le devoir Python avec QCM. Les seeds ne remettent pas à zéro des essais déjà commencés. Pour la configuration du cloud, suivre [l’activation opérateur](CLOUD_ACTIVATION.md).
