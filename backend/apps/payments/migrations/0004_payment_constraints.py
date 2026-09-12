from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0003_backfill_payment_statuses'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='payment',
            index=models.Index(fields=['status', 'expires_at'], name='payments_status_expiry_idx'),
        ),
        migrations.AddIndex(
            model_name='payment',
            index=models.Index(condition=models.Q(('requires_refund', True)), fields=['created_at'], name='payments_needs_refund_idx'),
        ),
        migrations.AddConstraint(
            model_name='payment',
            constraint=models.UniqueConstraint(condition=models.Q(('provider_reference', ''), _negated=True), fields=('provider', 'provider_reference'), name='payments_provider_reference_unique'),
        ),
        migrations.AddConstraint(
            model_name='payment',
            constraint=models.UniqueConstraint(condition=models.Q(('status__in', ('pending', 'processing'))), fields=('booking',), name='payments_one_open_per_booking'),
        ),
        migrations.AddConstraint(
            model_name='payment',
            constraint=models.CheckConstraint(condition=models.Q(('provider', ''), _negated=True), name='payments_provider_set'),
        ),
        migrations.AddConstraint(
            model_name='payment',
            constraint=models.CheckConstraint(condition=models.Q(('status__in', ['pending', 'processing', 'successful', 'failed', 'cancelled', 'refunded', 'partially_refunded'])), name='payments_status_valid'),
        ),
        migrations.AddConstraint(
            model_name='payment',
            constraint=models.CheckConstraint(condition=models.Q(('payment_method__in', ['card', 'bank_transfer', 'mobile_wallet', 'cash', ''])), name='payments_method_valid'),
        ),
        migrations.AddConstraint(
            model_name='payment',
            constraint=models.CheckConstraint(condition=models.Q(models.Q(('status__in', ('successful', 'partially_refunded', 'refunded')), _negated=True), ('paid_at__isnull', False), _connector='OR'), name='payments_captured_has_paid_at'),
        ),
        migrations.AddConstraint(
            model_name='payment',
            constraint=models.CheckConstraint(condition=models.Q(('refunded_amount__gte', 0), ('refunded_amount__lte', models.F('amount'))), name='payments_refund_within_amount'),
        ),
    ]
