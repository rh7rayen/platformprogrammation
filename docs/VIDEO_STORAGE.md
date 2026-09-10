# Enregistrement d’écran et stockage privé

Le module enregistre **la surface choisie par l’étudiant**, uniquement après activation du bouton et autorisation du navigateur. Il ne capture ni microphone ni webcam. L’étudiant peut interrompre la capture à tout moment. Les métadonnées de sessions et de segments servent au suivi technique ; elles ne constituent pas une détection d’IA ou une preuve automatique de fraude.

## Parcours livré

1. `ScreenRecorder` vérifie la disponibilité réelle du stockage sans déclencher de partage.
2. L’étudiant accepte l’information de conservation puis clique sur « Choisir un écran et enregistrer ». `getDisplayMedia` ouvre le choix du navigateur.
3. L’API authentifiée enregistre le consentement versionné `screen-v1` et ouvre une session liée à sa propre tentative, encore active. Une seule session peut être active par tentative ; un verrou sur la tentative et un index unique arbitrent les accès simultanés.
4. Le navigateur produit des clips autonomes d’environ quinze secondes (nouveau `MediaRecorder` pour chaque clip). Les données d’un simple `timeslice` ne sont pas considérées comme des vidéos indépendantes. La rotation des enregistreurs peut introduire une courte coupure entre clips.
5. L’API réserve un numéro de segment et génère une URL d’upload. Les octets sont envoyés **directement au bucket privé**, sans transiter dans NestJS, Next.js ni PostgreSQL. Les chemins sont générés côté serveur : `université/tentative/session/UUID.webm`.
6. L’API confirme le segment après lecture de sa taille et de son type MIME réels dans Storage. Elle ne se contente pas de la déclaration du navigateur. Les réessais utilisent le même identifiant, l’écrasement est désactivé et la contrainte `(session, sequence)` prévient les doublons.
7. `RecordingsReview` permet aux enseignants effectivement affectés à la matière de consulter les segments. Un rôle administrateur seul ne donne pas accès aux vidéos. Chaque lien de lecture dure deux minutes.

## Configuration nécessaire

Les valeurs par défaut désactivent le transfert cloud. L’interface affiche explicitement « stockage vidéo privé non configuré ». Aucun transfert à l’enseignant n’est annoncé sans confirmation du stockage.

Un **test local distinct** est disponible dans un devoir actif quand le stockage est indisponible. `LocalScreenCapture` exige un clic et un consentement dédiés avant `getDisplayMedia`, puis utilise un `MediaRecorder` réel. Il ne dépend d’aucune API réseau : la vidéo reste dans l’onglet, avec aperçu et téléchargement volontaire sur l’appareil. Elle ne fait pas partie des pièces de la copie ni du tableau enseignant. Le test s’arrête après 60 secondes ; il ne conserve jamais plus de 8 Mio de blobs. Les buffers internes de l’encodeur navigateur ne sont pas contrôlables depuis JavaScript. Les pistes, minuteries et URLs `blob:` sont libérées à l’arrêt ou au démontage ; quitter la page peut perdre un fichier non téléchargé.

Variables serveur, jamais `NEXT_PUBLIC_*` :

```dotenv
RECORDINGS_ENABLED=true
SUPABASE_URL=https://VOTRE-PROJET.supabase.co
SUPABASE_SERVICE_ROLE_KEY=secret-serveur
RECORDINGS_BUCKET=exam-recordings
RECORDINGS_RETENTION_DAYS=30
```

Créer dans le projet Supabase un bucket **privé**, de type standard, avec `file_size_limit` inférieur ou égal à `4194304` octets et `allowed_mime_types` limité à `video/webm` et/ou `video/mp4`. L’API refuse un bucket public ou non borné. Autoriser les requêtes de l’origine de la plateforme dans la configuration réseau pertinente. Ne pas ajouter de politique donnant une lecture publique ou un droit générique d’écriture aux étudiants : les autorisations sont vérifiées par le serveur avant chaque signature. La clé de service reste exclusivement dans un gestionnaire de secrets côté serveur.

Aucun compte, bucket payant ou déploiement n’a été créé par cette livraison. L’intégration cloud nécessite les identifiants du projet et une validation sur ce projet réel.

## Limites et continuité

- Quatre sessions au maximum par tentative ; bail de soixante secondes renouvelé à chaque nouveau segment.
- Segment maximum : 4 Mio. Quota total réservé par tentative : 512 Mio, 2 000 segments maximum. Ces plafonds protègent le stockage ; ils ne remplacent pas des quotas de facturation par établissement.
- Capture souhaitée : 10 images par seconde et environ 250 kbit/s, sans audio. Les navigateurs peuvent adapter ces paramètres.
- Deux clips maximum attendent le transfert en mémoire. Une connexion lente, un clip trop grand ou un échec arrête la capture et produit un message explicite. Les clips en attente ne sont pas sauvegardés sur disque ; fermer/recharger l’onglet peut les perdre. L’avertissement de fermeture est activé quand la capture ou un transfert reste en cours.
- La remise du devoir arrête la capture. Une session préexistante peut réserver **un dernier segment** dans les deux minutes suivant la fin ; elle ne peut pas se prolonger indéfiniment. La confirmation d’un segment réservé expire après deux minutes.
- Un navigateur peut enregistrer une fenêtre ou un onglet plutôt que l’écran entier. La page n’a aucun moyen fiable de voir un autre appareil ou de garantir l’absence d’outils externes. Les métadonnées fournies par un client peuvent être falsifiées ; aucune sanction automatique ne doit en découler.
- Les vidéos reçues ne sont pas transcodées ou analysées par le serveur dans cette version. Une extension devra vérifier le conteneur média dans un worker isolé et produire des dérivés de lecture sûrs avant diffusion à grande échelle.

Les URLs signées d’upload Supabase sont valides **deux heures**. La fenêtre de confirmation de l’application est plus courte, mais ne révoque pas le jeton d’upload du fournisseur. Le bucket borné, les chemins aléatoires uniques et `upsert:false` limitent ce que permet chaque jeton. Ne jamais journaliser une URL signée.

## Conservation et maintenance

Chaque session possède `expires_at`. La lecture est refusée dès cette date, même si la suppression physique est encore en attente. Le worker suivant supprime jusqu’à cent objets par exécution, puis marque les métadonnées `DELETED` seulement après confirmation du fournisseur. Il retire aussi les objets réservés restés non confirmés après trois heures (au-delà de la validité d’un jeton d’upload).

```powershell
node node_modules/tsx/dist/cli.mjs backend/src/monitoring/purge-recordings.ts
```

Planifier ce worker toutes les cinq minutes **dans l’infrastructure de production**, augmenter la fréquence/le nombre de lots selon la charge et alerter sur ses échecs. Cette planification reste à configurer ; afficher une durée de conservation n’implique pas que le worker est déjà déployé. En mode local PGlite, ne pas démarrer une deuxième instance sur le même dossier de données : exécuter la maintenance lorsque le serveur local est arrêté. En production PostgreSQL, exécuter la maintenance avec un compte technique dédié et une connexion TLS vérifiée.

Configurer également une politique de cycle de vie côté stockage si le fournisseur choisi la prend en charge, afin de couvrir les objets orphelins en cas de perte de métadonnées. Sauvegarder PostgreSQL et la configuration du bucket, tester une restauration, surveiller volume d’objets, octets par établissement, retard de suppression, taux d’échec et durée des transferts. La purge ne garantit pas la suppression des sauvegardes du fournisseur : leur conservation doit être définie contractuellement.

## Tests et passage à l’échelle

`backend/test/monitoring.test.ts` exerce les transactions et les politiques RLS réelles sur PostgreSQL embarqué : propriétaire, enseignant affecté, refus administrateur, concurrence, ordre et limites, métadonnées incohérentes, idempotence, expiration, dernier segment, purge. **Le stockage est simulé dans ces tests de contrat** ; ce ne sont pas des tests de capture navigateur ou d’un cloud réel.

`tests/e2e/local-capture.spec.ts` vérifie le test local dans Chrome avec un flux canvas synthétique : encodeur MediaRecorder réel, lecture et téléchargement du résultat, zéro transfert vidéo, consentement, refus tardif, démontage, remise pendant capture et limites. Le choix de partage est substitué par le flux synthétique ; ces tests ne filment pas le véritable écran de l’utilisateur et ne valident pas le fournisseur cloud.

Avant ouverture à une population réelle : tester la capture et la lecture dans chaque navigateur pris en charge avec un bucket de préproduction, couper le réseau, fermer le partage, remettre au milieu d’un clip, simuler un stockage indisponible et vérifier les suppressions. Les tests automatiques ne doivent jamais déclencher le partage du véritable écran d’un utilisateur.

L’upload direct élimine les vidéos du trafic API et de la base relationnelle. Pour une charge élevée, répartir les métadonnées par établissement et date, utiliser un pooler PostgreSQL, placer les API sans état derrière une passerelle avec quotas partagés, ajouter une file pour vérification/transcodage et une file distincte pour suppression. Un objectif de cent millions de connexions ne peut pas être garanti par du code seul : dimensionner sur le nombre de captures simultanées, le débit moyen, le budget réseau et stockage, puis valider par des campagnes de charge progressives sur l’infrastructure choisie.

## Références techniques

- [Supabase — upload via URL signée](https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl)
- [Supabase — restrictions d’un bucket](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [MDN — choix explicite de partage avec getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [MDN — fonctionnement de MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
