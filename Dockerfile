FROM resin/rpi-raspbian:jessie-20160831  
FROM hypriot/rpi-node:slim

ARG DIR=/srv/video
ARG DIR_IMAGES=/mnt/usbdrive/video-files

# dirs - create all that are needed
RUN mkdir -p ${DIR} && \
  mkdir -p /storage && \
  mkdir -p /storage_d

WORKDIR ${DIR}

# Install app dependencies
COPY package.json ${DIR}
RUN npm install .

COPY video_svr.js ${DIR}
# Bundle app source
COPY . ${DIR}

ENV LL=info
CMD [ "npm", "start"]
