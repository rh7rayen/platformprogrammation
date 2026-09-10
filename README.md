# platformprogrammation — UniExam

Plateforme d’examens universitaires en français, construite avec **Next.js, NestJS et PostgreSQL/Supabase**. L’enseignant prépare un devoir pour sa classe, choisit un langage, publie et invite les étudiants. Le candidat ouvre son espace de travail avec son compte et son code personnel, sauvegarde ses réponses puis remet sa copie.

Cette livraison propose **20 langages/environnements**, un éditeur Monaco, un projet Web à trois fichiers avec aperçu interactif, les invitations email configurables, les captures vers un stockage privé et une revue de similarité locale. **Un runner Docker local exécute les langages préparés ; email et vidéo enseignante nécessitent des services cloud configurés.** Aucun cloud payant n’a été créé et aucun envoi réel n’est annoncé.

## Essayer immédiatement

Prérequis : Node.js **24.18.0** et npm **11.16.0**. Le mode local n’exige aucun compte externe.

```sh
npm ci
npm run dev
```

Ouvrir [la plateforme locale](http://localhost:3000/?view=exams). La page **Devoirs & examens** est l’entrée par défaut.

| Parcours | Compte fictif | Essai |
| --- | --- | --- |
| Enseignant PHP/Java/Web | **Sami Haddad** | Créer un devoir pour un enseignement **Ingénieur 1**, choisir le type de question et son langage, publier, inviter, consulter les copies. |
| Étudiante Ingénieur 1 | **Lina Ben Salem** | `DEMO-PHP`, `DEMO-JAVA` ou `DEMO-WEB` dans le champ du code, puis ouvrir et commencer le devoir correspondant. |
| Python et QCM | **Nour Mansour** | Code `PYTHON-DEMO`, éditeur `main.py` et question QCM. |
| Administration | **Amira Ben Ali** | Structure, classes, matières, inscriptions et affectations. |

Pour voir une application fonctionner **sans runner**, choisir **Lina → DEMO-WEB**, modifier `index.html`, `style.css` et `script.js`, puis actualiser l’aperçu intégré. L’aperçu exécute le Web dans une iframe isolée ; les dépendances réseau, les projets backend et les applications persistantes ne sont pas inclus. PHP et Java proposent leur éditeur et la remise ; leur bouton d’exécution indique l’absence de runner tant que celui-ci n’est pas configuré.

Les changements sont enregistrés par NestJS dans PGlite, un PostgreSQL embarqué, avec les mêmes migrations métier. Ce mode est distinct d’une connexion à Supabase distant. L’API écoute sur [127.0.0.1:4000/api/v1](http://127.0.0.1:4000/api/v1/health/ready). La démo refuse le mode production et l’écoute hors loopback ; ne pas l’exposer par tunnel public.

## Fonctions livrées

- Organisation universitaire, matières, classes, profils existants, rôles, affectations et inscriptions, avec permissions et RLS par université.
- Devoirs composés de programmation, QCM ou rédaction : horaires, durée, barème, politique de collage, publication immuable et attribution aux inscrits de la classe.
- Catalogue de 20 environnements, accessible directement en haut de la page enseignant : Python, PHP, Java, JavaScript, TypeScript, C, C++, C#, Go, Rust, Ruby, Bash, SQLite, Web, React, Angular, Symfony, Laravel, MySQL et Oracle PL/SQL. Le langage appartient à la question ; l’étudiant ne peut pas en changer librement.
- Monaco servi localement, gestion des fichiers Web, sauvegarde versionnée, reprise, minuteur serveur, remise atomique et expiration même sans navigateur. QCM noté automatiquement, autres réponses corrigées par l’enseignant.
- File d’exécution durable et adaptateurs **Docker / Judge0 privé**, quotas, contrôle des versions et sorties bornées. Aucun code étudiant n’est lancé dans NestJS. SQLite et MySQL utilisent des bases pédagogiques éphémères.
- Projets React, Angular, Symfony et Laravel, fichiers distincts et aperçu après compilation/exécution. Oracle PL/SQL : édition disponible, exécution soumise à validation de son moteur. Voir [les environnements](docs/FRAMEWORKS.md).
- Invitations **Resend** aux étudiants déjà affectés : codes personnels, file chiffrée, état d’envoi et réémission explicite après échec/expiration, plafonnée. Sans configuration, aucune invitation n’est envoyée.
- Capture d’écran consentie et segments envoyés directement vers **Supabase Storage privé**, sans octets vidéo dans la base ; consultation par l’enseignant affecté et purge à planifier. Le transfert cloud réel reste à valider.
- Comparaison locale de séquences de code entre copies, avec extraits et limites explicites. **Ce n’est pas un détecteur fiable d’IA ni une preuve de fraude** ; aucune note ou sanction automatique.
- Assistant de propositions QCM IA privé, avec quota et validation ; son fournisseur reste désactivé sans configuration.

Le provisionnement complet des comptes Supabase, leur invitation d’inscription, MFA, récupération, SSO, imports, aménagements individuels et archivage avancé ne sont pas livrés. L’invitation à un **devoir** ne crée pas un compte étudiant. Le blocage du presse-papiers est un contrôle d’interface contournable.

## Vérification et maintenance

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
node scripts/verify-monaco.mjs
```

Les tests d’API utilisent NestJS et PostgreSQL/PGlite réels avec une identité de démonstration. Les tests runner, email et vidéo cloud utilisent des fournisseurs simulés pour vérifier les contrats, les permissions, les quotas et les pannes ; ils ne prouvent pas une compilation ou un transfert cloud réel. La capture locale est testée avec le vrai MediaRecorder Chrome et un flux canvas synthétique, sans filmer l’écran utilisateur.

Les parcours navigateur utilisent Chrome installé et leur propre serveur : Next sur **3100**, API sur **4100**, PGlite éphémère **en mémoire** et compilation `.next-e2e`. Ils ne réutilisent jamais la démo sur 3000/4000 et n’écrivent pas ses copies ni ses devoirs. Un port de test déjà occupé fait échouer le lancement ; arrêter le précédent lanceur de tests proprement avant de réessayer.

Les vérifications séparent contrats simulés, 12 parcours navigateur ordinaires, compilateurs réellement exécutés et parcours UI sur Docker. Les résultats et limites figurent dans [PROJECT_STATUS.md](PROJECT_STATUS.md).

Monaco est reconstruit depuis ESM avec **DOMPurify 3.4.15** : le bundle AMD vulnérable n’est plus publié. Le dernier audit npm local ne signale aucune vulnérabilité ; ce résultat ne remplace pas un audit d’infrastructure. La CI et Dependabot sont fournis, sans déploiement ni fusion automatique. Quatre skills de travail ont été installés dans l’environnement Codex local : `playwright`, `security-best-practices`, `security-threat-model` et `gh-fix-ci` ; ils ne sont pas des services exécutés par UniExam.

## Activer les services externes

Partir de `.env.example`, puis suivre [l’activation cloud](docs/CLOUD_ACTIVATION.md) et [le déploiement](docs/DEPLOYMENT.md). Supabase gère la base, l’identité et le stockage ; le runner Docker ou Judge0 tourne sur des machines séparées ; Resend nécessite un domaine expéditeur vérifié. Les clés restent exclusivement serveur, hors Git et hors `NEXT_PUBLIC_*`.

Pour la forte charge, lire [le plan de capacité](docs/CAPACITY_PLAN.md). `node scripts/capacity-model.mjs --help` expose un modèle paramétrable, sans envoyer de trafic. **Cent millions de connexions simultanées ne sont pas une capacité démontrée** : il faut une infrastructure financée, des objectifs mesurables et des campagnes de charge.

## Données locales et arrêt

`DEMO_DATA_DIR` vaut `.data/uniexam` par défaut. Sur ce poste, `.env` sélectionne `.data/uniexam-exams` : l’ancienne base `.data/uniexam` avait échoué à la récupération du journal/checkpoint après interruption. Elle et la copie `.data/uniexam-backup-before-recovery` restent conservées ; aucune restauration de leurs anciennes données n’a réussi.

Utiliser **Ctrl+C**, puis attendre la fermeture de l’API. Le lanceur vérifie les ports et la base persistante possède désormais un verrou exclusif libéré après flush. Après un arrêt forcé, ne pas supprimer la base ou relancer plusieurs API : suivre la [procédure du verrou](docs/SECURITY_REVIEW.md). Les seeds ne réinitialisent ni les tentatives ni leurs échéances.

## Documentation

- [État vérifiable et limites](PROJECT_STATUS.md)
- [Guides administrateur, enseignant et étudiant](docs/USER_GUIDES.md)
- [Architecture et frontières de confiance](docs/ARCHITECTURE.md)
- [Devoirs, remise et correction](docs/EXAMS_IMPLEMENTED.md)
- [Runner et langages](docs/RUNNERS.md)
- [React, Angular, Symfony, Laravel et bases pédagogiques](docs/FRAMEWORKS.md)
- [Capture et stockage vidéo](docs/VIDEO_STORAGE.md)
- [Revue de sécurité et maintenance](docs/SECURITY_REVIEW.md)
- [Permissions](docs/PERMISSIONS.md), [contrats API](docs/API.md), [spécification cible](docs/ASSESSMENT_WORKFLOW.md)

Les modules métier sont dans `backend/src/` (`auth`, `academic`, `users`, `assessments`, `execution`, `invitations`, `monitoring`, `integrity`, `ai`). `frontend/` contient Next et le BFF, `packages/contracts/` les schémas partagés, `scripts/` les outils locaux, `infrastructure/` les configurations de déploiement et `tests/e2e/` les parcours navigateur.
