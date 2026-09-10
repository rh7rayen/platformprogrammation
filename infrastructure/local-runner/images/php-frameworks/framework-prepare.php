<?php
declare(strict_types=1);

try {
    $framework = $argv[1] ?? '';
    $allowed = match ($framework) {
        'symfony' => ['src/Controller/ExamController.php', 'templates/exam.html.twig'],
        'laravel' => ['routes/web.php', 'resources/views/exam.blade.php'],
        default => throw new RuntimeException('Framework inconnu.'),
    };
    $raw = file_get_contents('/work/project.json');
    if ($raw === false || strlen($raw) > 131072) throw new RuntimeException('Projet JSON trop volumineux.');
    $project = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($project) || count($project) !== 3 || ($project['format'] ?? '') !== 'uniexam-project-v1' || ($project['runtime'] ?? '') !== $framework || !is_array($project['files'] ?? null)) {
        throw new RuntimeException('Format de projet invalide.');
    }
    $names = array_keys($project['files']); sort($names); $expected = $allowed; sort($expected);
    if ($names !== $expected) throw new RuntimeException('Seuls les deux fichiers prévus par le devoir sont acceptés.');
    foreach ($project['files'] as $text) {
        if (!is_string($text) || strlen($text) > 50000 || str_contains($text, "\0")) throw new RuntimeException('Fichier source invalide.');
    }
    function copyTemplate(string $from, string $to): void {
        if (!is_dir($to) && !mkdir($to, 0700, true)) throw new RuntimeException('Création du projet impossible.');
        foreach (new DirectoryIterator($from) as $entry) {
            if ($entry->isDot() || $entry->getFilename() === 'vendor') continue;
            if ($entry->isLink()) throw new RuntimeException('Lien inattendu dans le modèle.');
            $target = $to.'/'.$entry->getFilename();
            if ($entry->isDir()) copyTemplate($entry->getPathname(), $target);
            elseif (!copy($entry->getPathname(), $target)) throw new RuntimeException('Copie du modèle impossible.');
        }
    }
    copyTemplate('/opt/frameworks/'.$framework, '/tmp/app');
    if (!symlink('/opt/frameworks/'.$framework.'/vendor', '/tmp/app/vendor')) throw new RuntimeException('Dépendances indisponibles.');
    foreach ($allowed as $name) {
        $directory = dirname('/tmp/app/'.$name);
        if (!is_dir($directory)) mkdir($directory, 0700, true);
        if (file_put_contents('/tmp/app/'.$name, $project['files'][$name]) === false) throw new RuntimeException('Écriture de la source impossible.');
    }
    foreach (['var/cache', 'var/log', 'bootstrap/cache', 'storage/framework/views', 'storage/framework/sessions', 'storage/framework/cache', 'storage/logs', 'app'] as $directory) {
        if (!is_dir('/tmp/app/'.$directory)) mkdir('/tmp/app/'.$directory, 0700, true);
    }
    fwrite(STDOUT, "Projet préparé avec les dépendances présentes dans l’image.\n");
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage()."\n");
    exit(1);
}
