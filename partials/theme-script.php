<?php defined('PRINTAN_VIEW') || exit; ?>
    <script>
        // 深淺色模式功能
        function setTheme(theme) {
            document.body.className = theme === 'system'
                ? 'is-rounded'
                : `is-rounded is-${theme}`;

            const secure = location.protocol === 'https:' ? '; Secure' : '';
            document.cookie = `preferred-theme=${theme}; path=/; max-age=31536000; SameSite=Lax${secure}`; // 1 year
        }

        function getPreferredTheme() {
            const cookies = document.cookie.split(';');
            for (let cookie of cookies) {
                const [name, value] = cookie.trim().split('=');
                if (name === 'preferred-theme') {
                    return value;
                }
            }
            return 'system';
        }

        document.addEventListener('DOMContentLoaded', function () {
            const preferredTheme = getPreferredTheme();
            const themeRadio = document.getElementById(`theme-${preferredTheme}`);
            if (themeRadio) {
                themeRadio.checked = true;
                setTheme(preferredTheme);
            }
        });

        document.getElementById('theme-light').addEventListener('change', function () {
            if (this.checked) setTheme('light');
        });
        document.getElementById('theme-dark').addEventListener('change', function () {
            if (this.checked) setTheme('dark');
        });
        document.getElementById('theme-system').addEventListener('change', function () {
            if (this.checked) setTheme('system');
        });
    </script>
