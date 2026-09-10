<?php
declare(strict_types=1);

try {
    $framework = $argv[1] ?? '';
    if (!in_array($framework, ['symfony', 'laravel'], true)) throw new RuntimeException('Framework inconnu.');
    $input = stream_get_contents(STDIN, 4001);
    if (strlen($input) > 4000) throw new RuntimeException('Requête limitée à 4 000 octets.');
    $requestData = trim($input) === '' ? ['method' => 'GET', 'path' => '/', 'body' => []] : json_decode($input, true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($requestData) || array_diff(array_keys($requestData), ['method', 'path', 'body'])) throw new RuntimeException('Requête JSON invalide.');
    $method = $requestData['method'] ?? 'GET'; $path = $requestData['path'] ?? '/'; $body = $requestData['body'] ?? [];
    if (!in_array($method, ['GET', 'POST'], true) || !is_string($path) || strlen($path) > 1024 || !str_starts_with($path, '/') || str_starts_with($path, '//') || preg_match('/[\x00-\x20\\\\]/', $path)) throw new RuntimeException('Méthode ou chemin de requête invalide.');
    $parameters = [];
    if (is_string($body)) parse_str($body, $parameters);
    elseif (is_array($body) && (!array_is_list($body) || $body === [])) {
        if (count($body) > 64) throw new RuntimeException('Corps de requête trop grand.');
        foreach ($body as $name => $value) if (!is_string($name) || !is_string($value)) throw new RuntimeException('Le corps doit contenir des paires texte/texte.');
        $parameters = $body;
    } else throw new RuntimeException('Le corps doit être du texte de formulaire ou un objet texte/texte.');
    $content = is_string($body) ? $body : http_build_query($parameters);
    chdir('/tmp/app');
    $_SERVER['APP_ENV'] = $_ENV['APP_ENV'] = 'testing';
    $_SERVER['APP_DEBUG'] = $_ENV['APP_DEBUG'] = 'false';
    putenv('APP_ENV=testing'); putenv('APP_DEBUG=false');
    $loader = require '/tmp/app/vendor/autoload.php';
    $loader->setPsr4('App\\', $framework === 'symfony' ? '/tmp/app/src' : '/tmp/app/app');
    ob_start();
    $server = ['HTTP_HOST' => 'uniexam-preview.invalid', 'SERVER_NAME' => 'uniexam-preview.invalid', 'CONTENT_TYPE' => 'application/x-www-form-urlencoded', 'SCRIPT_NAME' => '/index.php', 'SCRIPT_FILENAME' => '/tmp/app/public/index.php'];
    if ($framework === 'symfony') {
        $request = Symfony\Component\HttpFoundation\Request::create($path, $method, $parameters, [], [], $server, $content);
        $kernel = new App\Kernel('testing', false);
        $response = $kernel->handle($request);
    } else {
        $application = require '/tmp/app/bootstrap/app.php';
        $kernel = $application->make(Illuminate\Contracts\Http\Kernel::class);
        $request = Illuminate\Http\Request::create($path, $method, $parameters, [], [], $server, $content);
        $response = $kernel->handle($request);
    }
    $incidental = ob_get_clean();
    if ($incidental !== '') fwrite(STDOUT, substr($incidental, 0, 8192));
    $html = $response->getContent();
    if (!is_string($html)) throw new RuntimeException('Les réponses diffusées en continu ne sont pas prises en charge.');
    if (strlen($html) > 2 * 1024 * 1024) throw new RuntimeException('Aperçu HTML limité à 2 Mio.');
    if (file_put_contents('/tmp/preview.html', $html) === false) throw new RuntimeException('Écriture de l’aperçu impossible.');
    $status = $response->getStatusCode();
    fwrite(STDOUT, 'HTTP '.$status.' · '.strlen($html)." octets · requête de test sans état.\n");
    // No cookies or application headers are exported to the authenticated parent.
    $kernel->terminate($request, $response);
    if ($status >= 500) { fwrite(STDERR, "Le framework a renvoyé une erreur serveur. Consultez votre contrôleur ou votre vue.\n"); exit(1); }
} catch (Throwable $error) {
    while (ob_get_level() > 0) ob_end_clean();
    fwrite(STDERR, substr(get_class($error).': '.$error->getMessage(), 0, 16384)."\n");
    exit(1);
}
