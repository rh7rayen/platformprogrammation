# Oracle's free MySQL Community Server, not Enterprise and not MariaDB/SQLite.
# Bootstrap records the resulting immutable image ID after a real SQL self-test.
FROM container-registry.oracle.com/mysql/community-server:8.4 AS upstream

# Keep the official binaries and their license files, but discard upstream
# VOLUME/ENTRYPOINT metadata: even an unused automatic volume defeats job cleanup.
FROM scratch
COPY --from=upstream / /
COPY --chmod=0555 uniexam-mysql-init /usr/local/bin/uniexam-mysql-init
COPY --chmod=0555 uniexam-mysql-run /usr/local/bin/uniexam-mysql-run
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp TMPDIR=/tmp
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["sleep"]
CMD ["120"]
