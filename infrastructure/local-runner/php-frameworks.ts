import type {Runtime} from './catalog.js';
type PhpFrameworkDefinition=Omit<Runtime,'id'> & {id:'symfony'|'laravel';previewFile:'/tmp/preview.html'};
export const symfonyStarterFiles={
  'src/Controller/ExamController.php':'<?php\nnamespace App\\Controller;\nuse Symfony\\Bundle\\FrameworkBundle\\Controller\\AbstractController;\nuse Symfony\\Component\\HttpFoundation\\Request;\nuse Symfony\\Component\\HttpFoundation\\Response;\nuse Symfony\\Component\\Routing\\Attribute\\Route;\nfinal class ExamController extends AbstractController\n{\n    #[Route("/", name: "exam", methods: ["GET", "POST"])]\n    public function index(Request $request): Response\n    {\n        $name = $request->request->get("name", $request->query->get("name", "monde"));\n        return $this->render("exam.html.twig", ["name" => $name]);\n    }\n}\n',
  'templates/exam.html.twig':'<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><title>Mon devoir Symfony</title><style>body{font-family:system-ui;padding:2rem;color:#163c30}h1{color:#197353}</style></head><body><h1>Bonjour {{ name }} !</h1><p>Une vraie réponse Symfony et Twig.</p></body></html>\n',
};
export const laravelStarterFiles={
  'routes/web.php':'<?php\nuse Illuminate\\Http\\Request;\nuse Illuminate\\Support\\Facades\\Route;\nRoute::match(["get", "post"], "/", function (Request $request) {\n    return view("exam", ["name" => $request->input("name", "monde")]);\n});\n',
  'resources/views/exam.blade.php':'<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><title>Mon devoir Laravel</title><style>body{font-family:system-ui;padding:2rem;color:#163c30}h1{color:#c34e36}</style></head><body><h1>Bonjour {{ $name }} !</h1><p>Une vraie réponse Laravel et Blade.</p></body></html>\n',
};
export const phpFrameworkRuntimes:readonly PhpFrameworkDefinition[]=(['symfony','laravel'] as const).map(id=>({
  id,version:id==='symfony'?'Symfony 7.4.18 / PHP 8.4':'Laravel 13.31.0 / PHP 8.4',
  image:'uniexam/php-frameworks:php8.4-symfony7.4-laravel13-v1',filename:'project.json',build:'php-frameworks',
  compile:[['php','-d','memory_limit=256M','/opt/uniexam/framework-prepare.php',id]],
  run:['php','-d','memory_limit=384M','-d','display_errors=stderr','/opt/uniexam/framework-request.php',id],
  previewFile:'/tmp/preview.html',env:['APP_ENV=testing','APP_DEBUG=false','LOG_CHANNEL=stderr','CACHE_STORE=array','SESSION_DRIVER=array'],
  sample:JSON.stringify({format:'uniexam-project-v1',runtime:id,files:id==='symfony'?symfonyStarterFiles:laravelStarterFiles}),
}));
