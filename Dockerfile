FROM node:10.4.1
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
# Installing ffmpeg
RUN echo "deb http://ftp.br.debian.org/debian/ jessie-backports main contrib non-free" | tee -a /etc/apt/sources.list
RUN apt-get update
RUN apt-get install ffmpeg -y

COPY services/ /etc/service/
RUN chmod +x /etc/service/*/run
RUN chown -R node:node /src

ENTRYPOINT ["runsvdir"]
CMD ["/etc/service/"]