#!/bin/bash
# Bu depodaki commit'lerin yazarını repo sahibinin GitHub hesabına sabitler.
#
# Neden gerekli: Vercel, dağıtımı tetikleyen commit'in YAZARINI (author) bir
# GitHub hesabına eşler ve o hesabın projeye katkı erişimi yoksa dağıtımı
# reddeder. Hobby planı özel repolarda ek üye kabul etmediği için, sahibin
# hesabı dışında bir kimlikle atılan her commit dağıtımı bloke eder.
#
# Claude Code konteynerlerinde global git kimliği "Claude <noreply@anthropic.com>"
# olarak gelir; GitHub bu adresi "claude" hesabına atfeder. Aşağıdaki ayar
# yalnızca bu deponun yerel git yapılandırmasına (.git/config) yazar, global
# ayara dokunmaz, bu yüzden diğer depoları etkilemez.
#
# Kullanılan adres ugursivrikaya22 hesabının GitHub noreply adresidir
# (kullanıcı kimliği 295430257): commit doğrudan o hesaba atfedilir ve özel
# bir e-posta adresi depo geçmişine sızmaz.
set -euo pipefail

git config user.name "ugursivrikaya22"
git config user.email "295430257+ugursivrikaya22@users.noreply.github.com"

echo "Git commit kimliği ugursivrikaya22 olarak ayarlandı (yalnızca bu depo)."
