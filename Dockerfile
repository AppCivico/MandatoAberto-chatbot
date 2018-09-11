FROM node:latest
ENV NPM_CONFIG_LOGLEVEL warn

EXPOSE 8080

USER root
RUN mkdir src
RUN chown -R node:node /src
RUN apt-get update
RUN apt-get install -y runit

USER node
ADD package.json /src/
WORKDIR /src

RUN npm install bottender dotenv
RUN npm install
ADD . /src

USER root
COPY services/ /etc/service/
RUN chmod +x /etc/service/*/run
RUN chown -R node:node /src

ENTRYPOINT ["runsvdir"]
CMD ["/etc/service/"]