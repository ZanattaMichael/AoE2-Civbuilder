# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: build the native .dat rewriter.
#
# create-data-mod links against genieutils and jsoncpp and is the only piece of
# the application that needs a C++ toolchain. Building it in a throwaway stage
# keeps compilers and headers out of the runtime image.
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS native-build

# genieutils requires ZLIB, LZ4, Boost.iostreams and Iconv (see its
# CMakeLists.txt); jsoncpp is linked by create-data-mod itself.
RUN apt-get update && apt-get install --no-install-recommends -y \
        build-essential \
        cmake \
        git \
        ca-certificates \
        libjsoncpp-dev \
        zlib1g-dev \
        liblz4-dev \
        libboost-iostreams-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# genieutils is a git submodule. Cloning it at a pinned commit here — rather
# than COPYing it in — means the image builds from a fresh checkout without
# requiring `git submodule update --init` first, and pins the exact revision.
ARG GENIEUTILS_REPO=https://github.com/Tapsa/genieutils
ARG GENIEUTILS_REF=d35204a8b02c3ab5bd3d07c88668d73cefa3bad4
RUN git clone "${GENIEUTILS_REPO}" genieutils \
    && git -C genieutils checkout --detach "${GENIEUTILS_REF}"

# genieutils compiles ../pcrio/pcrio.c from a sibling directory, so pcrio must
# sit alongside the genieutils checkout even though this repo's own CMakeLists
# does not mention it.
COPY modding/pcrio ./pcrio

# jsoncpp is linked from the system package (-ljsoncpp), not vendored.
COPY modding/CMakeLists.txt ./
COPY modding/create-data-mod.cpp modding/civbuilder.cpp modding/civbuilder.h ./
COPY modding/helpers.cpp modding/helpers.h ./

RUN cmake -S . -B build -DSTATIC_COMPILE=TRUE && cmake --build build -j "$(nproc)"


# ---------------------------------------------------------------------------
# Stage 2: install production node modules.
#
# Separated so that application source changes do not force a dependency
# reinstall, and so devDependencies never reach the runtime image.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

WORKDIR /app

# canvas@3 ships prebuilt binaries with its own bundled cairo/pango, so no
# native toolchain is required here.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev


# ---------------------------------------------------------------------------
# Stage 3: runtime.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Only -static-libstdc++ is passed at link time, so create-data-mod still needs
# its shared dependencies at runtime. tini reaps zombies from the native binary
# so PID 1 does not accumulate defunct children.
RUN apt-get update && apt-get install --no-install-recommends -y \
        libjsoncpp25 \
        liblz4-1 \
        libboost-iostreams1.74.0 \
        tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    APP_DIR=/app \
    PORT=4000 \
    HOST=0.0.0.0

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=native-build /build/build/create-data-mod ./modding/build/create-data-mod

# Application source. Ordered least- to most-frequently changed.
COPY package.json package-lock.json ./
COPY public ./public
COPY process_mod ./process_mod
COPY src ./src
COPY server.js ./

# Writable state lives in volumes; everything else is owned by root and
# read-only to the application user.
RUN mkdir -p /app/drafts /app/modding/requested_mods \
    && chown -R node:node /app/drafts /app/modding/requested_mods \
    && chmod +x /app/modding/build/create-data-mod

USER node

VOLUME ["/app/drafts", "/app/modding/requested_mods"]

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||4000,path:(process.env.BASE_PATH||'/civbuilder')+'/healthz'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
