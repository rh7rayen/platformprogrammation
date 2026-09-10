# Projets et bases pédagogiques

Dans **Devoirs & examens → Créer un devoir de programmation**, cliquez directement sur un des 20 environnements. Le formulaire ouvre le premier exercice dans ce langage ; son choix est aussi visible dès la première étape de **Créer un devoir**. Les cartes situées dessous sont les devoirs déjà créés. L’enseignement (par exemple Développement PHP) rattache le devoir à une classe et une matière ; le langage de chaque question se choisit séparément dans **Questions & langages → Programmation → Langage de programmation**.

Python et C# appartiennent au catalogue de programmes console. React, Angular, Symfony, Laravel, MySQL et Oracle PL/SQL disposent de choix distincts. Le catalogue vérifie le service et distingue **Exécution prête**, **Aperçu web** et **Édition seule**. Les étudiants voient les devoirs publiés pour leur classe ; le catalogue de création est réservé aux enseignants affectés.

| Environnement | Fichiers modifiables | Résultat |
| --- | --- | --- |
| React 19.3 | `App.tsx`, `style.css` | TypeScript et JSX compilés, page interactive avec composants et hooks. |
| Angular 22.1 | `app.component.ts`, `style.css` | Composant standalone et template inline compilés AOT, page interactive. |
| Symfony 7.4 | `src/Controller/ExamController.php`, `templates/exam.html.twig` | Requête GET/POST exécutée par le vrai kernel, rendu Twig. |
| Laravel 13 | `routes/web.php`, `resources/views/exam.blade.php` | Requête GET/POST exécutée par le vrai kernel, rendu Blade. |
| MySQL Community 8.4 | `query.sql` | Requêtes, tables et procédures sur une nouvelle base MySQL à chaque exécution. |
| Oracle PL/SQL | `main.sql` | Édition et remise ; moteur indisponible tant que la recette Oracle isolée n’est pas validée. |

L’enseignant peut modifier les fichiers initiaux. L’étudiant utilise les onglets de fichiers, puis **Exécuter**. Le code est sauvegardé avant son envoi ; la console indique la version effectivement exécutée. **Agrandir l’éditeur**, **Plein écran**, la taille du texte et la console repliable restent disponibles. Les copies remises présentent leurs fichiers séparément à l’enseignant.

## Tester une requête Symfony ou Laravel

L’entrée vide représente `GET /`. Pour tester les paramètres du modèle livré, saisir dans **Entrée standard · Requête HTTP (JSON)** :

```json
{"method":"GET","path":"/?name=Lina"}
```

Ou envoyer un formulaire :

```json
{"method":"POST","path":"/","body":{"name":"Lina"}}
```

Le kernel traite réellement la requête et rend sa réponse HTML dans l’aperçu. Chaque clic crée un nouvel environnement sans session ni serveur permanent. L’aperçu montre la réponse de cette requête : les liens et formulaires de la page ne remplacent pas le champ de test HTTP. Aucun cookie ou en-tête de connexion UniExam n’est transmis au framework.

## Limites utiles pour préparer un examen

Les dépendances sont installées lors de la préparation des images. L’étudiant n’installe pas de paquets npm/Composer et n’accède pas à Internet. React/Angular proposent un composant et sa feuille de style ; Symfony/Laravel proposent deux fichiers convenus. Il ne s’agit pas d’un environnement arbitraire permettant de cloner n’importe quel dépôt, de lancer un terminal système, de garder un serveur en arrière-plan ou de connecter le projet à la base MySQL d’un autre exercice.

MySQL et SQLite restent deux moteurs différents. Les tables d’un exercice MySQL disparaissent après chaque exécution ; le script doit contenir les créations et données nécessaires. Le compte MySQL pédagogique ne reçoit ni privilège FILE, ni accès à `mysql.user`, ni droit de déléguer des permissions. Les commandes de client permettant un shell ou le chargement de fichiers sont refusées. Aucun SQL étudiant n’utilise la connexion de la base métier.

Le format `uniexam-project-v1` fixe le framework et les noms de fichiers. API et runner refusent les chemins ajoutés, fichiers manquants et changements de framework. Le contenu total reste limité à 30 000 octets. Les environnements compilent au plus 45 secondes et exécutent au plus 5 secondes ; MySQL dispose d’une phase d’initialisation indépendante, réservée au script de confiance.

## Aperçus et données

Les aperçus compilés ne sont pas stockés dans PostgreSQL. Le daemon les conserve en mémoire : 2 Mio par aperçu, 8 Mio au total, dix minutes au maximum, avec éviction des plus anciens si nécessaire. L’API vérifie le propriétaire de la tentative avant de demander un aperçu au daemon. Un aperçu expiré peut être reconstruit tant que le devoir est ouvert.

Le HTML reste dans une iframe d’origine opaque avec politique CSP restrictive. Il ne peut pas lire le document parent ou ses cookies. Les appels réseau, frames imbriquées et envois de formulaires sont bloqués ; la page parent interdit également les destinations externes dans ses frames.

La comparaison de copies lit les fichiers sources et exclut le code initial. Elle reste une comparaison lexicale, pas une preuve d’utilisation d’une IA. Les dépendances communes des frameworks et leurs bundles compilés ne sont jamais des copies étudiantes à comparer.

## Préparation locale

Avec Docker Linux démarré et le secret privé configuré suivant [RUNNERS.md](RUNNERS.md) :

```sh
npm run runner:setup
npm run runner:start
# Dans un autre terminal :
npm run dev
```

Une reconstruction ne devient disponible qu’après un vrai programme réussi et l’inspection des options Docker. Les images validées sont ensuite utilisées par identifiant SHA-256 immuable. Le catalogue affiche explicitement les environnements absents ou non validés.

Tests ciblés : `npm run test:runner:live -- frameworks.spec.ts`. Cette commande démarre une API de test en mémoire sur 4100 et Next sur 3100 ; elle utilise le véritable runner et respecte les quotas. Les tests réels des images se trouvent dans `infrastructure/local-runner/test/`, derrière leurs interrupteurs d’activation explicites.
