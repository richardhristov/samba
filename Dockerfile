FROM alpine:3.16

RUN apk add --no-cache samba-client samba-server samba-common-tools

COPY smb.conf /etc/samba/smb.conf

ARG SAMBA_USER
ARG SAMBA_PASS

RUN adduser -s /sbin/nologin -h /home/samba -H -u 3000 -D "$SAMBA_USER"
RUN (echo "$SAMBA_PASS"; echo "$SAMBA_PASS") | smbpasswd -a -s "$SAMBA_USER"
RUN echo "  valid users = $SAMBA_USER" >> /etc/samba/smb.conf

EXPOSE 137/udp
EXPOSE 138/udp
EXPOSE 139/tcp
EXPOSE 445/tcp

CMD ["smbd", "--foreground", "--debug-stdout", "--no-process-group"]
