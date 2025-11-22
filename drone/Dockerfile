FROM python:3.9-bookworm

# Base OS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git g++ make ccache libtool pkg-config ninja-build \
    libxml2-dev libxslt1-dev sudo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

# Non-root build user
RUN useradd -ms /bin/bash -u 1000 ardupilot \
    && echo 'ardupilot ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers \
    && chown -R ardupilot:ardupilot /opt

USER ardupilot
SHELL ["/bin/bash","-lc"]

# ArduPilot source + submodules
RUN git clone --depth=1 --recurse-submodules https://github.com/ArduPilot/ardupilot.git
RUN git -C ardupilot submodule update --init --recursive

ENV USER=ardupilot SUDO_USER=ardupilot

# Build prereqs just for SITL
RUN pip install --no-cache-dir pexpect "empy==3.3.4"
RUN source ~/.profile && cd ardupilot && ./waf configure --board sitl
RUN source ~/.profile && cd ardupilot && ./waf copter

# Runtime tools
USER root
RUN pip install --no-cache-dir MAVProxy pymavlink pexpect future

# Entrypoint + default param file
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY sysid.parm /opt/sysid.parm
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /opt/ardupilot/ArduCopter
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
