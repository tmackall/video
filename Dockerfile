FROM resin/rpi-raspbian:jessie-20160831  
FROM hypriot/rpi-node:slim

ARG PORT=3050
ARG DIR_VIDEO=/srv/video

# dirs - create all that are needed
RUN mkdir -p ${DIR_VIDEO} && \
  mkdir -p /storage && \
  mkdir -p /storage_d

WORKDIR ${DIR_VIDEO}

# Install app dependencies
COPY package.json ${DIR_VIDEO}
RUN npm install .

# Bundle app source
COPY . ${DIR_VIDEO}


EXPOSE ${PORT}
ENV LL=debug
CMD [ "npm", "start"]
