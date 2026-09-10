FROM composer:2.8 AS composer
FROM php:8.4-cli-alpine3.22
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
RUN apk add --no-cache oniguruma libxml2 sqlite-libs \
 && apk add --no-cache --virtual .framework-build-deps $PHPIZE_DEPS oniguruma-dev libxml2-dev sqlite-dev \
 && docker-php-ext-install -j1 mbstring dom xml pdo_sqlite \
 && apk del .framework-build-deps
ENV COMPOSER_ALLOW_SUPERUSER=1 COMPOSER_HOME=/tmp/composer
COPY symfony/ /opt/frameworks/symfony/
COPY laravel/ /opt/frameworks/laravel/
RUN composer install --working-dir=/opt/frameworks/symfony --no-dev --no-interaction --no-progress --prefer-dist --no-plugins --no-scripts --optimize-autoloader \
 && composer install --working-dir=/opt/frameworks/laravel --no-dev --no-interaction --no-progress --prefer-dist --no-plugins --no-scripts --optimize-autoloader \
 && composer audit --working-dir=/opt/frameworks/symfony --no-dev --no-interaction \
 && composer audit --working-dir=/opt/frameworks/laravel --no-dev --no-interaction \
 && rm -rf /tmp/composer
COPY framework-prepare.php framework-request.php /opt/uniexam/
RUN php -l /opt/uniexam/framework-prepare.php \
 && php -l /opt/uniexam/framework-request.php
