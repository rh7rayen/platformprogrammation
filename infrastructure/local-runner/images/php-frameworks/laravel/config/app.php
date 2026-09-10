<?php
return [
    'name' => 'UniExam isolated preview', 'env' => 'testing', 'debug' => false,
    'url' => 'http://uniexam-preview.invalid', 'timezone' => 'UTC',
    'locale' => 'fr', 'fallback_locale' => 'en', 'faker_locale' => 'fr_FR',
    // Public fixture key, never an application or account secret. Each preview is stateless.
    'key' => 'base64:'.base64_encode(str_repeat('u', 32)), 'cipher' => 'AES-256-CBC',
];
