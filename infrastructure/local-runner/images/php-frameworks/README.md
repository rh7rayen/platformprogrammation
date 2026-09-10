# Projets PHP dans les vrais frameworks

Cette image contient Symfony FrameworkBundle7.4.18, TwigBundle7.4.15 et Laravel13.31.0, sur PHP8.4. Les versions directes sont exactes et les deux `composer.lock` figent les dépendances transitives. La construction installe les dépendances sans plugins ni scripts Composer et exécute `composer audit`. Aucun Composer, serveur PHP ou paquet de framework n’est installé sur Windows.

Les définitions importables sont dans `../../php-frameworks.ts`. Elles utilisent `/work/project.json` et écrivent uniquement un projet temporaire sous `/tmp/app`. Les dépendances `vendor` demeurent dans l’image en lecture seule. Les caches de framework, les vues compilées et les journaux sont temporaires. Le daemon conserve ses contraintes réseau, utilisateur, mémoire, processus et délais ; aucun port de serveur n’est ouvert.

## Fichiers et requête de test

Le format est `{"format":"uniexam-project-v1","runtime":"symfony|laravel","files":{...}}`. Le moteur accepte exactement les fichiers du devoir :

| Framework | Fichiers étudiants |
| --- | --- |
| Symfony | `src/Controller/ExamController.php`, `templates/exam.html.twig` |
| Laravel | `routes/web.php`, `resources/views/exam.blade.php` |

Les autres fichiers du squelette, du routage, de la configuration et des dépendances sont fixés par l’image. Les chemins supplémentaires, la traversée de répertoires et les projets d’un autre runtime sont refusés avant d’exécuter le code. Les bornes de l’API UniExam et du daemon continuent de s’appliquer ; le lecteur interne refuse également un projet supérieur à128Kio ou un fichier supérieur à50 000octets.

L’entrée standard vide représente `GET /`. Une requête personnalisée, limitée à4 000octets, s’écrit :

```json
{"method":"POST","path":"/","body":{"name":"Lina"}}
```

Le corps accepte aussi une chaîne de formulaire, par exemple `"name=Lina"`. La méthode est GET ou POST ; le chemin est relatif au projet, commence par `/`, sans URL absolue, caractères de contrôle ni antislash. Les cookies, fichiers envoyés, WebSockets et appels à un service externe ne sont pas pris en charge.

Le contrôleur reçoit un véritable objet Request de Symfony HttpFoundation ou Illuminate. Le véritable Kernel du framework produit la réponse. Chaque clic reconstruit un conteneur indépendant en environnement `testing` ; aucun état de session, cookie ou base de données ne persiste entre deux clics. Le comportement CSRF de Laravel correspond à ce contexte de test, pas à une application déployée.

L’aperçu est le corps de la réponse dans `/tmp/preview.html`, plafonné à2Mio. Le journal indique le statut HTTP et le nombre d’octets ; les cookies et en-têtes du framework ne sont pas transmis à la page UniExam. Une route404 reste une requête réellement exécutée, avec une réponse404 affichable. Une erreur500 produit aussi un diagnostic d’échec. Les réponses diffusées en continu ne sont pas gérées. L’interface parent affiche le résultat dans son iframe isolée ; elle doit conserver ses propres limites et sa CSP, même si le contenu provient d’un framework.

## Vérification réelle

Après construction et coordination avec les autres tests Docker :

```powershell
node --import tsx infrastructure/local-runner/images/php-frameworks/verify.ts --run
```

Ce script utilise les images présentes et le moteur isolé, sans modifier le manifeste partagé. Il produit `.data/framework-verification.json` et vérifie GET, POST, paramètres,404, vue modifiée, erreur PHP, chemins refusés, URL absolue refusée, échappement Twig/Blade et dépassement réel du temps. Les échecs restent visibles et donnent un code de sortie non nul.

Sources primaires : [Symfony7.4](https://symfony.com/doc/7.4/setup.html), [Request/Response et HttpKernel](https://symfony.com/doc/7.4/components/http_kernel.html), [cycle de requête Laravel13](https://laravel.com/framework/docs/13.x/lifecycle), [tests HTTP Laravel](https://laravel.com/framework/docs/13.x/http-tests), [sécurité des plugins et scripts Composer](https://getcomposer.org/doc/faqs/how-to-install-untrusted-packages-safely.md).
