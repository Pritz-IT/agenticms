# nginx-only. The admin container produces the static output into the shared
# `builds` volume and writes .htpasswd-{target} for staging Basic Auth.

FROM nginx:1.27-alpine

COPY nginx/nginx.conf.template /etc/nginx/nginx.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

RUN mkdir -p /var/www/builds /assets /etc/nginx/conf.d

EXPOSE 80 8080

ENTRYPOINT ["/docker-entrypoint.sh"]
