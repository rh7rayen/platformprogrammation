<?php
return ['driver' => 'array', 'lifetime' => 1, 'expire_on_close' => true, 'encrypt' => false,
    'files' => '/tmp/app/storage/framework/sessions', 'connection' => null, 'table' => 'sessions',
    'store' => null, 'lottery' => [0, 100], 'cookie' => 'uniexam_preview', 'path' => '/',
    'domain' => null, 'secure' => false, 'http_only' => true, 'same_site' => 'lax', 'partitioned' => false];
