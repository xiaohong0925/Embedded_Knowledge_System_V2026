// SPDX-License-Identifier: GPL-2.0
/*
 * Linux v6.6 SPI framework teaching example.
 *
 * This is a read-only protocol observer for a controlled W25Q128JV setup.
 * It is not a replacement for the in-kernel spi-nor/MTD driver stack.
 */
#include <linux/errno.h>
#include <linux/module.h>
#include <linux/of.h>
#include <linux/slab.h>
#include <linux/spi/spi.h>
#include <linux/string.h>

#define OBSERVER_CMD_LEN  5
#define OBSERVER_DATA_LEN 4

static int spi_frame_observer_read(struct spi_device *spi, u32 address,
				   u8 *data)
{
	struct spi_transfer transfers[2] = { };
	struct spi_message message;
	u8 *tx_buf;
	u8 *rx_buf;
	int ret;

	if (address > 0xffffff)
		return -EINVAL;

	/* kmalloc-family buffers can be mapped by the SPI core if DMA is used. */
	tx_buf = kzalloc(OBSERVER_CMD_LEN, GFP_KERNEL);
	rx_buf = kzalloc(OBSERVER_DATA_LEN, GFP_KERNEL);
	if (!tx_buf || !rx_buf) {
		ret = -ENOMEM;
		goto out_free;
	}

	/* Fast Read: opcode, 24-bit address, then eight dummy clocks. */
	tx_buf[0] = 0x0b;
	tx_buf[1] = (address >> 16) & 0xff;
	tx_buf[2] = (address >> 8) & 0xff;
	tx_buf[3] = address & 0xff;
	tx_buf[4] = 0x00;

	/* Segment 0 sends the command and ignores simultaneous MISO data. */
	transfers[0].tx_buf = tx_buf;
	transfers[0].len = OBSERVER_CMD_LEN;

	/* Segment 1 shifts out zeroes and captures four simultaneous MISO bytes. */
	transfers[1].rx_buf = rx_buf;
	transfers[1].len = OBSERVER_DATA_LEN;

	spi_message_init(&message);
	spi_message_add_tail(&transfers[0], &message);
	spi_message_add_tail(&transfers[1], &message);

	/* Stack-held message/transfer descriptors live until spi_sync returns. */
	ret = spi_sync(spi, &message);
	if (ret < 0)
		goto out_free;

	if (message.actual_length != OBSERVER_CMD_LEN + OBSERVER_DATA_LEN) {
		ret = -EIO;
		goto out_free;
	}

	memcpy(data, rx_buf, OBSERVER_DATA_LEN);

out_free:
	kfree(rx_buf);
	kfree(tx_buf);
	return ret;
}

static int spi_frame_observer_probe(struct spi_device *spi)
{
	u8 data[OBSERVER_DATA_LEN] = { };
	int ret;

	dev_info(&spi->dev,
		 "matched: cs=%u, mode=0x%x, max_speed_hz=%u, bits_per_word=%u\n",
		 spi->chip_select, spi->mode, spi->max_speed_hz,
		 spi->bits_per_word);

	ret = spi_frame_observer_read(spi, 0x001234, data);
	if (ret < 0) {
		dev_err(&spi->dev, "fast_read failed: ret=%d\n", ret);
		return ret;
	}

	dev_info(&spi->dev,
		 "fast_read: ret=0, addr=0x001234, data=%02x %02x %02x %02x\n",
		 data[0], data[1], data[2], data[3]);

	return 0;
}

static void spi_frame_observer_remove(struct spi_device *spi)
{
	dev_info(&spi->dev, "unbound\n");
}

static const struct of_device_id spi_frame_observer_of_match[] = {
	{ .compatible = "kimi,spi-frame-observer" },
	{ }
};
MODULE_DEVICE_TABLE(of, spi_frame_observer_of_match);

static struct spi_driver spi_frame_observer_driver = {
	.driver = {
		.name = "spi_frame_observer",
		.of_match_table = spi_frame_observer_of_match,
	},
	.probe = spi_frame_observer_probe,
	.remove = spi_frame_observer_remove,
};
module_spi_driver(spi_frame_observer_driver);

MODULE_AUTHOR("Embedded Knowledge System V2026");
MODULE_DESCRIPTION("Read-only SPI framework teaching observer");
MODULE_LICENSE("GPL");
