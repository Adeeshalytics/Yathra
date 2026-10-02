{{/* Release-scoped base name, e.g. "yathra". */}}
{{- define "yathra.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 40 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 40 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "yathra.commonLabels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
app.kubernetes.io/part-of: yathra
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Labels for objects that belong to the release as a whole (ConfigMap, Ingress). */}}
{{- define "yathra.labels" -}}
{{ include "yathra.commonLabels" . }}
app.kubernetes.io/instance: {{ .Release.Name | quote }}
{{- end -}}

{{/* Selector labels for one component: include with (dict "ctx" $ "component" "api"). */}}
{{- define "yathra.selectorLabels" -}}
app.kubernetes.io/name: {{ .component | quote }}
app.kubernetes.io/instance: {{ .ctx.Release.Name | quote }}
{{- end -}}

{{- define "yathra.componentLabels" -}}
{{ include "yathra.commonLabels" .ctx }}
{{ include "yathra.selectorLabels" . }}
app.kubernetes.io/component: {{ .component | quote }}
{{- end -}}

{{- define "yathra.image" -}}
{{- $tag := required "image.tag is required (CI publishes sha-<commit>)" .ctx.Values.image.tag -}}
{{- printf "%s/yathra-%s:%s" .ctx.Values.image.registry .name $tag -}}
{{- end -}}

{{- define "yathra.scheme" -}}
{{- if .Values.tls.enabled }}https{{ else }}http{{ end -}}
{{- end -}}

{{- define "yathra.origin" -}}
{{- printf "%s://%s" (include "yathra.scheme" .) .Values.host -}}
{{- end -}}

{{- define "yathra.dbClusterName" -}}
{{- printf "%s-db" (include "yathra.fullname" .) -}}
{{- end -}}

{{/* Pod-level security settings that meet the "restricted" Pod Security Standard. */}}
{{- define "yathra.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .gid }}
fsGroup: {{ .gid }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "yathra.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end -}}

{{/*
Everything the API image needs at run time: the shared ConfigMap, the app Secret, and the
database address from the Secret CloudNativePG generates.
*/}}
{{- define "yathra.backendEnv" -}}
envFrom:
  - configMapRef:
      name: {{ include "yathra.fullname" . }}-config
  - secretRef:
      name: {{ .Values.django.secretName }}
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        {{- if .Values.postgres.enabled }}
        name: {{ include "yathra.dbClusterName" . }}-app
        key: uri
        {{- else }}
        name: {{ required "postgres.external.secretName is required when postgres.enabled=false" .Values.postgres.external.secretName }}
        key: {{ .Values.postgres.external.secretKey }}
        {{- end }}
{{- end -}}

{{/*
An init container that holds a pod until the migration Job of this image tag has applied the
schema, so new code never runs against an old schema. Used by the API and the CronJobs.
*/}}
{{- define "yathra.waitForMigrations" -}}
- name: wait-for-migrations
  image: {{ include "yathra.image" (dict "ctx" . "name" "backend") }}
  imagePullPolicy: {{ .Values.image.pullPolicy }}
  command:
    - sh
    - -c
    - |
      until python manage.py migrate --check >/dev/null 2>&1; do
        echo "Waiting for database migrations to be applied…"
        sleep 5
      done
  {{- include "yathra.backendEnv" . | nindent 2 }}
  securityContext:
    {{- include "yathra.containerSecurityContext" . | nindent 4 }}
  resources:
    {{- toYaml .Values.cronJobDefaults.resources | nindent 4 }}
  volumeMounts:
    - name: tmp
      mountPath: /tmp
{{- end -}}

{{/* Restarts pods when the configuration they read at start-up changes. */}}
{{- define "yathra.configChecksum" -}}
checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
{{- end -}}

{{/* NetworkPolicy peers: the ingress controller's pods, and Prometheus. */}}
{{- define "yathra.ingressControllerPeer" -}}
namespaceSelector:
  matchLabels:
    kubernetes.io/metadata.name: {{ .Values.networkPolicy.ingressNamespace }}
podSelector:
  matchLabels:
    {{- toYaml .Values.networkPolicy.ingressPodLabels | nindent 4 }}
{{- end -}}

{{- define "yathra.prometheusPeer" -}}
namespaceSelector:
  matchLabels:
    kubernetes.io/metadata.name: {{ .Values.networkPolicy.monitoringNamespace }}
podSelector:
  matchLabels:
    app.kubernetes.io/name: prometheus
{{- end -}}
